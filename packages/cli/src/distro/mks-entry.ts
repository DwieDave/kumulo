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

const _mksPlanLive = (config: MksClusterConfig) =>
  Effect.gen(function*() {
    const mks = yield* lookupMksInventory(config)
    const volumeNames = yield* lookupManagedVolumeNames(config)
    // delete plan must never reach OpenStack (read-only network resolution belongs to apply only)
    const resolvedNetwork = yield* resolveMksNetwork(config)
    return buildMksPlan({
      config,
      inventory: { ...mks, volumeNames, ...(resolvedNetwork === undefined ? {} : { resolvedNetwork }) }
    })
  }).pipe(Effect.provide(mksCloudProviderLayer(config)))

// teardown order: load balancer, floating IP, then network with its subnets
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

// OVH exposes no quota endpoint in the vendored codegen slice (see
// `doctor/ovh/quota.ts`), so the ceiling is the documented per-project
// default; swap for a live read once that endpoint is vendored.
const _OVH_MAX_CLUSTERS = 10

const _mksDoctorChecks = Effect.fn(function*({ config }: { readonly config: ClusterConfig }) {
  const { mks: client, serviceName } = yield* MksEnv
  const mks = { getCloudProjectServiceNameKube: (name: string) => client.getCloudProjectServiceNameKube(name, undefined) }
  return [
    authValidityCheck({ mks, serviceName }),
    projectAccessCheck({ mks, serviceName }),
    planVsQuotaCheck({ mks, serviceName, plannedClusterCount: 1, maxClusters: _OVH_MAX_CLUSTERS }),
    regionVersionCapabilityCheck({ region: config.auth.region, version: config.version })
  ]
})

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
  appliedPrefixes: ["network/", "subnet/", "gateway/", "mks-cluster/", "mks-pool/", "load-balancer/", "floating-ip/"],
  selfProgress: true,
  status: _statusMks,
  upgrade: _upgradeMksEntry,
  credentialsLabel: "ovh api",
  requiredEnvVars: ["OVH_CLIENT_ID", "OVH_CLIENT_SECRET", "OVH_SERVICE_NAME"],
  doctorChecks: _mksDoctorChecks
}
