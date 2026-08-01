import { Effect } from "effect"
import type { BucketInfo, Plan, PlanAction } from "@kumulo/core"
import {
  clusterDrift,
  findClusterByName,
  listNodeGroups,
  networkName,
  uksPoolHash
} from "@kumulo/distro-upcloud-uks"
import type { ExistingNodeGroup, UksWorkerPoolConfig } from "@kumulo/distro-upcloud-uks"
import { mapUpcloudError } from "@kumulo/upcloud"
import type { MksError, ObjectStorageError, VolumeError } from "@kumulo/core"
import type { UpcloudUksClusterConfig } from "../cluster-config.ts"
import { UpcloudEnv } from "./env.ts"
import { bucketPlanActions, configuredUpcloudBuckets, lookupUpcloudBuckets, uksBucketRow } from "./storage.ts"
import { lookupUpcloudVolumes, managedUpcloudVolumes, uksVolumeRow, volumePlanActions } from "./volumes.ts"
import type { LiveVolume } from "./volumes.ts"

/** Plan row names — shared with the reconciler, which maps a confirmed row back to its pool. */
export const uksClusterRow = (cluster: string): string => `uks-cluster/${cluster}`
// kumulo: plan ROWS are `<kind>/<cluster>` (mks/plan.ts's convention, and what
// `upcloud-uks-entry.ts`'s `appliedPrefixes` matches on). `networkName`/
// `routerName` are the UpCloud *resource* names — used to find the resources,
// never to label a row: a `staging-eu-network` row matches no prefix at all.
export const uksNetworkRow = (cluster: string): string => `network/${cluster}`
export const uksRouterRow = (cluster: string): string => `router/${cluster}`
export const uksPoolRow = ({ cluster, pool }: { readonly cluster: string; readonly pool: string }): string =>
  `uks-pool/${cluster}/${pool}`

/** Live existence, as looked up right before planning (see `lookupUpcloudInventory`). */
export interface UpcloudInventory {
  readonly clusterExists: boolean
  readonly uuid?: string
  readonly zone?: string
  readonly plan?: string
  readonly nodeGroups: ReadonlyArray<ExistingNodeGroup>
  readonly networkExists: boolean
  /** The live cluster's `network_cidr` — what AC6's network drift is judged on. */
  readonly networkCidr?: string
  /** AC6 wants creation-time drift named at PLAN time, so the plan reads this too — not just apply. */
  readonly storageEncryption?: boolean
  /** Live UpCloud storages labeled to this cluster (T6.1) — absent/empty for a config with no managed volumes. */
  readonly volumes?: ReadonlyArray<LiveVolume>
  /** Live buckets inside this cluster's D6 object-storage service (T6.1) — absent/empty when unconfigured or the service doesn't exist yet. */
  readonly buckets?: ReadonlyArray<BucketInfo>
}

/**
 * `UksClients` has no `findNetworkByName` of its own (`distro-upcloud-uks/network.ts`
 * doesn't export one — it's a private helper of `ensureNetwork`/`deleteNetwork`),
 * so the plan reads the same `list()` + name match directly, read-only.
 */
export const lookupUpcloudInventory = (
  config: UpcloudUksClusterConfig
): Effect.Effect<UpcloudInventory, MksError | ObjectStorageError | VolumeError, UpcloudEnv> =>
  Effect.gen(function*() {
    const { clients } = yield* UpcloudEnv
    const cluster = yield* findClusterByName({ clients, name: config.name })
    const nodeGroups = cluster === undefined ? [] : yield* listNodeGroups({ clients, ref: { uuid: cluster.uuid, name: cluster.name } })
    const networks = yield* mapUpcloudError({ self: clients.network.list(), ctx: { kind: "network", ref: config.name } })
    // T6.1: volumes/buckets are only looked up live when the config actually
    // manages some — an unconfigured module has nothing worth an extra round trip for.
    const volumes = yield* lookupUpcloudVolumes(config)
    const buckets = yield* lookupUpcloudBuckets(config)
    return {
      clusterExists: cluster !== undefined,
      uuid: cluster?.uuid,
      zone: cluster?.zone,
      plan: cluster?.plan,
      networkCidr: cluster?.networkCidr,
      storageEncryption: cluster?.storageEncryption,
      nodeGroups,
      networkExists: networks.some((network) => network.name === networkName(config.name)),
      volumes,
      buckets
    }
  })

const _createOrNoOp = (exists: boolean, name: string): PlanAction => exists ? { _tag: "NoOp", name } : { _tag: "Create", name }

/**
 * Cluster-level drift (T4.3): existence first (absent → `Create`), then the
 * immutable fields `clusterDrift` compares — any drift is `ReplaceNeedsConfirm`,
 * never a silent `Update` (D8: UKS has no PATCH path for these fields).
 */
const _clusterAction = (
  { config, inventory }: { readonly config: UpcloudUksClusterConfig; readonly inventory: UpcloudInventory }
): PlanAction => {
  const name = uksClusterRow(config.name)
  if (!inventory.clusterExists) return { _tag: "Create", name }
  const drift = clusterDrift({
    desired: { zone: config.zone, plan: config.plan, networkCidr: config.network.cidr, storageEncryption: config.storage_encryption },
    actual: {
      zone: inventory.zone,
      plan: inventory.plan,
      networkCidr: inventory.networkCidr,
      storageEncryption: inventory.storageEncryption
    }
  })
  return drift._tag === "None" ? { _tag: "NoOp", name } : { _tag: "ReplaceNeedsConfirm", name, reason: `${drift.field}: ${drift.reason}` }
}

/**
 * Same rule as `distro-ovh-mks`'s `mks/plan.ts` `_poolAction`: absent → Create,
 * no stamped hash → NoOp (exists, can't honestly tell it drifted), hash equal
 * (and count equal) → NoOp, count-only drift → Update, hash drift →
 * `ReplaceNeedsConfirm`. Rows removed from the config are not shown here — same
 * gap `mks/plan.ts` leaves (a read-only teardown-preview would need its own row
 * kind).
 */
const _poolAction = (
  { cluster, inventory, pool }: { readonly cluster: string; readonly inventory: UpcloudInventory; readonly pool: UksWorkerPoolConfig }
): PlanAction => {
  const name = uksPoolRow({ cluster, pool: pool.name })
  const match = inventory.nodeGroups.find((group) => group.poolLabel === pool.name)
  if (match === undefined) return { _tag: "Create", name }
  if (match.configHash === undefined) return { _tag: "NoOp", name }
  const hash = uksPoolHash(pool)
  if (match.configHash !== hash) return { _tag: "ReplaceNeedsConfirm", name, reason: "config-hash drifted from desired spec" }
  return match.count === pool.count ? { _tag: "NoOp", name } : { _tag: "Update", name, reason: "worker count drifted" }
}

/** The config's worker pool as `distro-upcloud-uks`'s input shape — the one place a config pool becomes a UKS node group spec. */
export const toUksPool = (
  pool: UpcloudUksClusterConfig["worker_pools"][number]
): UksWorkerPoolConfig => ({
  name: pool.name,
  plan: pool.flavor,
  count: pool.count,
  labels: pool.labels === undefined ? undefined : Object.entries(pool.labels).map(([key, value]) => ({ key, value })),
  taints: pool.taints
})

export const buildUpcloudPlan = (
  { config, inventory }: { readonly config: UpcloudUksClusterConfig; readonly inventory: UpcloudInventory }
): Plan => ({
  actions: [
    // Ahead of the cluster row: both ids are creation-time inputs to it (mirrors mks/plan.ts's network-before-cluster order).
    _createOrNoOp(inventory.networkExists, uksRouterRow(config.name)),
    _createOrNoOp(inventory.networkExists, uksNetworkRow(config.name)),
    _clusterAction({ config, inventory }),
    ...config.worker_pools.map((pool) => _poolAction({ cluster: config.name, inventory, pool: toUksPool(pool) })),
    // T6.1/AC5: volumes and buckets are independent of the cluster row itself
    // (both create against the account, not against the cluster's UUID), so
    // they're appended rather than threaded through `_clusterAction`.
    ...volumePlanActions({ config, live: inventory.volumes ?? [] }),
    ...bucketPlanActions({ config, live: inventory.buckets ?? [] })
  ]
})

/** Delete-plan rows (mirrors `mks-entry.ts`'s `_deletePlanActions`): cluster, its live node groups, then router+network. */
export const upcloudDeletePlanActions = (
  config: UpcloudUksClusterConfig
): Effect.Effect<Plan["actions"], MksError | ObjectStorageError | VolumeError, UpcloudEnv> =>
  Effect.gen(function*() {
    const inventory = yield* lookupUpcloudInventory(config)
    const clusterAction: PlanAction = inventory.clusterExists
      ? { _tag: "Delete", name: uksClusterRow(config.name) }
      : { _tag: "NoOp", name: `${uksClusterRow(config.name)} (already absent)` }
    const poolActions: ReadonlyArray<PlanAction> = inventory.nodeGroups.map((group) => ({
      _tag: "Delete",
      name: uksPoolRow({ cluster: config.name, pool: group.poolLabel ?? group.name })
    }))
    const networkActions: ReadonlyArray<PlanAction> = inventory.networkExists
      ? [uksRouterRow(config.name), uksNetworkRow(config.name)].map((name) => ({ _tag: "Delete" as const, name }))
      : []
    // D9: object storage + volumes are torn down ahead of the cluster —
    // named here in that order even though `deleteUpcloudUks` is what
    // actually executes it, so the plan preview matches apply's order.
    // Like volumes below, bucket rows reflect what exists LIVE — a config
    // bucket whose service is already gone must not plan a phantom Delete.
    const liveBucketNames = new Set((inventory.buckets ?? []).map((b) => b.name))
    const bucketActions: ReadonlyArray<PlanAction> = configuredUpcloudBuckets(config)
      .filter((bucket) => liveBucketNames.has(bucket.name))
      .map((bucket) =>
        bucket.retain
          ? { _tag: "NoOp" as const, name: `${uksBucketRow(bucket.name)} (retained)` }
          : { _tag: "Delete" as const, name: uksBucketRow(bucket.name) }
      )
    const liveVolumeNames = new Set((inventory.volumes ?? []).map((v) => v.name))
    const volumeActions: ReadonlyArray<PlanAction> = managedUpcloudVolumes(config)
      .filter((entry) => liveVolumeNames.has(entry.name))
      .map((entry) =>
        entry.retain
          ? { _tag: "NoOp" as const, name: `${uksVolumeRow(entry.name)} (retained)` }
          : { _tag: "Delete" as const, name: uksVolumeRow(entry.name) }
      )
    return [...bucketActions, ...volumeActions, clusterAction, ...poolActions, ...networkActions]
  })
