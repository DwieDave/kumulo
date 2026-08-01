import { Console, Effect } from "effect"
import { ResourceNotFound } from "@kumulo/core"
import type { LbInfo } from "@kumulo/core"
import type { ClusterConfig, MksClusterConfig } from "../cluster-config.ts"
import { findClusterByName, upgrade as upgradeMks } from "@kumulo/distro-ovh-mks"
import type { OutputsIngress } from "@kumulo/volumes-cinder"
import { lookupManagedVolumeNames } from "../commands/volumes.ts"
import { authValidityCheck, planVsQuotaCheck, projectAccessCheck, regionVersionCapabilityCheck } from "../doctor/ovh/index.ts"
import { MksEnv } from "../mks/env.ts"
import { mksCloudProviderLayer } from "../provider/registry.ts"
import type { DistroUpgradeArgs } from "./types.ts"
import { buildMksPlan } from "../mks/plan.ts"
import { applyMks, deleteMks, kubeconfigMks, lookupMksInventory, resolveMksNetwork } from "../mks/reconcile.ts"
import type { DistroEntry } from "./types.ts"

// Live plan for the ovh-mks path: cluster/pool existence via the OVH API,
// volume existence via Cinder — spec drift still converges through the
// idempotent ensure* verbs without showing here (see `buildMksPlan`).
const _mksPlanLive = (config: MksClusterConfig) =>
  Effect.gen(function*() {
    const mks = yield* lookupMksInventory(config)
    const volumeNames = yield* lookupManagedVolumeNames(config)
    // Read-only network resolution (R8) belongs to the apply plan alone: the
    // delete plan must never reach OpenStack.
    const resolvedNetwork = yield* resolveMksNetwork(config)
    return buildMksPlan({
      config,
      inventory: { ...mks, volumeNames, ...(resolvedNetwork === undefined ? {} : { resolvedNetwork }) }
    })
  }).pipe(Effect.provide(mksCloudProviderLayer(config)))

/**
 * The OpenStack resources teardown removes, in the order it removes them
 * (R17): load balancer, floating IP, then the network with its subnets. Rows
 * come off the *config*, not the live cluster — `deleteByTag` finds each
 * resource by name and deleting an absent one is a no-op, so a config that
 * declares a network always gets a `Delete` row for it.
 *
 * There is deliberately no `(retained)` variant here (D3/T5.2): a network is
 * fully reproducible from `cluster.json`, unlike a volume's or a bucket's
 * contents, so retaining one would strand an unowned resource for no gain.
 *
 * Every row is gated on the `network` block alone, `ingress` included: that is
 * the single condition `_deleteMksInfra` gates on, and `deleteByTag` then
 * deletes the LB and releases the floating IP unconditionally, finding both by
 * name. Gating the LB rows on `config.ingress` would under-report exactly the
 * config that removed its `ingress:` block before deleting — the teardown still
 * destroys the load balancer the earlier apply created.
 */
const _infraDeleteRows = (config: ClusterConfig): ReadonlyArray<string> => {
  if (config.distro !== "ovh-mks" || config.network === undefined) return []
  return [
    `load-balancer/${config.name}/ingress`,
    `floating-ip/${config.name}/ingress`,
    `subnet/${config.name}/nodes`,
    `subnet/${config.name}/load-balancers`,
    `network/${config.name}`
  ]
}

const _deletePlanActions = (config: ClusterConfig) =>
  Effect.gen(function*() {
    const inventory = yield* lookupMksInventory(config)
    const clusterAction = inventory.clusterExists
      ? { _tag: "Delete" as const, name: `mks-cluster/${config.name}` }
      : { _tag: "NoOp" as const, name: `mks-cluster/${config.name} (already absent)` }
    // Node pools go down with the cluster — one row per live pool, and an
    // "(already absent)" NoOp for configured pools with nothing live, so the
    // plan accounts for the whole config (same rule as the upcloud path).
    const poolActions = [
      ...[...inventory.poolNames].toSorted().map((pool) => ({
        _tag: "Delete" as const,
        name: `mks-pool/${config.name}/${pool}`
      })),
      ...config.worker_pools.filter((pool) => !inventory.poolNames.has(pool.name)).map((pool) => ({
        _tag: "NoOp" as const,
        name: `mks-pool/${config.name}/${pool.name} (already absent)`
      }))
    ]
    const infraActions = _infraDeleteRows(config).map((name) => ({ _tag: "Delete" as const, name }))
    return [clusterAction, ...poolActions, ...infraActions]
  }).pipe(Effect.provide(mksCloudProviderLayer(config)))

const _statusMks = Effect.fn(function*(config: ClusterConfig) {
  const { mks, serviceName } = yield* MksEnv
  const info = yield* findClusterByName({
    mks,
    config: { serviceName, name: config.name, region: config.auth.region, worker_pools: [] }
  })
  if (info === undefined) {
    yield* Console.log(`Cluster "${config.name}" does not exist.`)
    return
  }
  const pools = config.worker_pools.map((pool) => `${pool.name} (x${pool.count})`).join(", ") || "(none)"
  yield* Console.log(
    [`Cluster "${config.name}": ${info.status}`, `  API endpoint: ${info.apiEndpoint}`, `  Worker pools: ${pools}`]
      .join("\n")
  )
})

// OVH drives the upgrade itself via its API; there's no local plan
// to render, just a lookup (by name, same as every other mks command) + the
// update call. `workerConcurrency`/`dryRun` are k3s-only.
const _upgradeMksEntry = ({ config, strategy, yes }: DistroUpgradeArgs) =>
  Effect.gen(function*() {
    if (!yes) {
      yield* Console.log(`Re-run with --yes to upgrade cluster "${config.name}" (strategy: ${strategy}).`)
      return
    }
    const { mks, serviceName } = yield* MksEnv
    const info = yield* findClusterByName({ mks, config: { serviceName, name: config.name, region: config.auth.region, worker_pools: [] } })
    if (info === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "kube", ref: config.name }))
    yield* upgradeMks({ mks, ref: { serviceName, kubeId: info.id }, strategy })
    yield* Console.log(`Upgrade requested for cluster "${config.name}" (strategy: ${strategy}).`)
  })

// ponytail: OVH exposes no quota endpoint in the vendored codegen slice (see
// `doctor/ovh/quota.ts`), so the ceiling is the documented per-project
// default; swap for a live read once that endpoint is vendored.
const _OVH_MAX_CLUSTERS = 10

const _mksDoctorChecks = Effect.fn(function*({ config }: { readonly config: ClusterConfig }) {
  const { mks: client, serviceName } = yield* MksEnv
  // The checks' narrowed `OvhProjectClient` takes the service name only; the
  // generated client's optional per-call options are not used here.
  const mks = { getCloudProjectServiceNameKube: (name: string) => client.getCloudProjectServiceNameKube(name, undefined) }
  return [
    authValidityCheck({ mks, serviceName }),
    projectAccessCheck({ mks, serviceName }),
    planVsQuotaCheck({ mks, serviceName, plannedClusterCount: 1, maxClusters: _OVH_MAX_CLUSTERS }),
    regionVersionCapabilityCheck({ region: config.auth.region, version: config.version })
  ]
})

/**
 * The LB is only recorded once both its id and its floating IP are known — a
 * half-written block would tell a consumer to annotate a Service with an LB it
 * cannot reach. Ids and addresses only, never credentials (N6).
 */
const _ingressOutputs = (info: LbInfo | undefined): { readonly ingress?: OutputsIngress } =>
  info === undefined || info.id === "" || info.floatingIp === undefined || info.floatingIp === ""
    ? {}
    : { ingress: { load_balancer_id: info.id, floating_ip: info.floatingIp } }

export const mksEntry: DistroEntry<MksClusterConfig> = {
  kind: "ovh-mks",
  supportsObjectStorage: true,
  plan: _mksPlanLive,
  deletePlanActions: _deletePlanActions,
  apply: (a) =>
    applyMks({ config: a.config, replace: a.replace }).pipe(
      Effect.map((info) => ({
        summary: `\nCluster "${a.config.name}" is ${info.status} (${info.apiEndpoint}).`,
        ..._ingressOutputs(info.ingress)
      }))
    ),
  delete: deleteMks,
  kubeconfig: kubeconfigMks,
  deletedLabel: "mks-cluster",
  // `network/`/`subnet/` are converged inside `applyMks` too (ahead of the
  // cluster) — a row whose prefix is missing here renders and then never
  // checks off.
  appliedPrefixes: ["network/", "subnet/", "gateway/", "mks-cluster/", "mks-pool/", "load-balancer/", "floating-ip/"],
  status: _statusMks,
  upgrade: _upgradeMksEntry,
  credentialsLabel: "ovh api",
  requiredEnvVars: ["OVH_CLIENT_ID", "OVH_CLIENT_SECRET", "OVH_SERVICE_NAME"],
  doctorChecks: _mksDoctorChecks
}
