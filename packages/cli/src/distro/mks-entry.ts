import { Console, Effect } from "effect"
import { ResourceNotFound } from "@kumulo/core"
import type { ClusterConfig } from "@kumulo/core"
import { findClusterByName, upgrade as upgradeMks } from "@kumulo/distro-ovh-mks"
import { lookupManagedVolumeNames } from "../commands/volumes.ts"
import { authValidityCheck, planVsQuotaCheck, projectAccessCheck, regionVersionCapabilityCheck } from "../doctor/ovh/index.ts"
import { MksEnv } from "../mks/env.ts"
import type { DistroUpgradeArgs } from "./types.ts"
import { buildMksPlan } from "../mks/plan.ts"
import { applyMks, deleteMks, kubeconfigMks, lookupMksInventory } from "../mks/reconcile.ts"
import type { DistroEntry } from "./types.ts"

// Live plan for the ovh-mks path: cluster/pool existence via the OVH API,
// volume existence via Cinder — spec drift still converges through the
// idempotent ensure* verbs without showing here (see `buildMksPlan`).
const _mksPlanLive = (config: ClusterConfig) =>
  Effect.gen(function*() {
    const mks = yield* lookupMksInventory(config)
    const volumeNames = yield* lookupManagedVolumeNames(config)
    return buildMksPlan({ config, inventory: { ...mks, volumeNames } })
  })

const _deletePlanActions = (config: ClusterConfig) =>
  Effect.gen(function*() {
    const inventory = yield* lookupMksInventory(config)
    const clusterAction = inventory.clusterExists
      ? { _tag: "Delete" as const, name: `mks-cluster/${config.name}` }
      : { _tag: "NoOp" as const, name: `mks-cluster/${config.name} (already absent)` }
    // Node pools go down with the cluster — one row per live pool.
    const poolActions = [...inventory.poolNames].toSorted().map((pool) => ({
      _tag: "Delete" as const,
      name: `mks-pool/${config.name}/${pool}`
    }))
    return [clusterAction, ...poolActions]
  })

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

export const mksEntry: DistroEntry = {
  kind: "ovh-mks",
  supportsObjectStorage: true,
  plan: _mksPlanLive,
  deletePlanActions: _deletePlanActions,
  apply: (a) =>
    applyMks(a.config).pipe(
      Effect.map((info) => ({ summary: `\nCluster "${a.config.name}" is ${info.status} (${info.apiEndpoint}).` }))
    ),
  delete: deleteMks,
  kubeconfig: kubeconfigMks,
  deletedLabel: "mks-cluster",
  appliedPrefixes: ["mks-cluster/", "mks-pool/"],
  status: _statusMks,
  upgrade: _upgradeMksEntry,
  credentialsLabel: "ovh api",
  requiredEnvVars: ["OVH_CLIENT_ID", "OVH_CLIENT_SECRET", "OVH_SERVICE_NAME"],
  doctorChecks: _mksDoctorChecks
}
