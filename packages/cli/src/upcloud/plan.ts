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

export const uksClusterRow = (cluster: string): string => `uks-cluster/${cluster}`
export const uksNetworkRow = (cluster: string): string => `network/${cluster}`
export const uksRouterRow = (cluster: string): string => `router/${cluster}`
export const uksPoolRow = ({ cluster, pool }: { readonly cluster: string; readonly pool: string }): string =>
  `uks-pool/${cluster}/${pool}`

export interface UpcloudInventory {
  readonly clusterExists: boolean
  readonly uuid?: string
  readonly zone?: string
  readonly plan?: string
  readonly nodeGroups: ReadonlyArray<ExistingNodeGroup>
  readonly networkExists: boolean
  readonly networkCidr?: string
  readonly storageEncryption?: boolean
  readonly volumes?: ReadonlyArray<LiveVolume>
  readonly buckets?: ReadonlyArray<BucketInfo>
}

export const lookupUpcloudInventory = (
  config: UpcloudUksClusterConfig
): Effect.Effect<UpcloudInventory, MksError | ObjectStorageError | VolumeError, UpcloudEnv> =>
  Effect.gen(function*() {
    const { clients } = yield* UpcloudEnv
    const cluster = yield* findClusterByName({ clients, name: config.name })
    const nodeGroups = cluster === undefined ? [] : yield* listNodeGroups({ clients, ref: { uuid: cluster.uuid, name: cluster.name } })
    const networks = yield* mapUpcloudError({ self: clients.network.list(), ctx: { kind: "network", ref: config.name } })
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

// UKS has no PATCH for these fields, so any drift is ReplaceNeedsConfirm, never a silent Update
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
    _createOrNoOp(inventory.networkExists, uksRouterRow(config.name)),
    _createOrNoOp(inventory.networkExists, uksNetworkRow(config.name)),
    _clusterAction({ config, inventory }),
    ...config.worker_pools.map((pool) => _poolAction({ cluster: config.name, inventory, pool: toUksPool(pool) })),
    ...volumePlanActions({ config, live: inventory.volumes ?? [] }),
    ...bucketPlanActions({ config, live: inventory.buckets ?? [] })
  ]
})

export const upcloudDeletePlanActions = (
  config: UpcloudUksClusterConfig
): Effect.Effect<Plan["actions"], MksError | ObjectStorageError | VolumeError, UpcloudEnv> =>
  Effect.gen(function*() {
    const inventory = yield* lookupUpcloudInventory(config)
    const clusterAction: PlanAction = inventory.clusterExists
      ? { _tag: "Delete", name: uksClusterRow(config.name) }
      : { _tag: "NoOp", name: `${uksClusterRow(config.name)} (already absent)` }
    const livePoolLabels = new Set(inventory.nodeGroups.map((group) => group.poolLabel ?? group.name))
    const poolActions: ReadonlyArray<PlanAction> = [
      ...inventory.nodeGroups.map((group): PlanAction => ({
        _tag: "Delete",
        name: uksPoolRow({ cluster: config.name, pool: group.poolLabel ?? group.name })
      })),
      ...config.worker_pools.filter((pool) => !livePoolLabels.has(pool.name)).map((pool): PlanAction => ({
        _tag: "NoOp",
        name: `${uksPoolRow({ cluster: config.name, pool: pool.name })} (already absent)`
      }))
    ]
    const networkActions: ReadonlyArray<PlanAction> = [uksRouterRow(config.name), uksNetworkRow(config.name)].map((name) =>
      inventory.networkExists
        ? { _tag: "Delete" as const, name }
        : { _tag: "NoOp" as const, name: `${name} (already absent)` }
    )
    // bucket/volume teardown ordered ahead of cluster to match deleteUpcloudUks's execution order
    const liveBucketNames = new Set((inventory.buckets ?? []).map((b) => b.name))
    const bucketActions: ReadonlyArray<PlanAction> = configuredUpcloudBuckets(config).map((bucket) =>
      !liveBucketNames.has(bucket.name)
        ? { _tag: "NoOp" as const, name: `${uksBucketRow(bucket.name)} (already absent)` }
        : bucket.retain
        ? { _tag: "NoOp" as const, name: `${uksBucketRow(bucket.name)} (retained)` }
        : { _tag: "Delete" as const, name: uksBucketRow(bucket.name) }
    )
    const liveVolumeNames = new Set((inventory.volumes ?? []).map((v) => v.name))
    const volumeActions: ReadonlyArray<PlanAction> = managedUpcloudVolumes(config).map((entry) =>
      !liveVolumeNames.has(entry.name)
        ? { _tag: "NoOp" as const, name: `${uksVolumeRow(entry.name)} (already absent)` }
        : entry.retain
        ? { _tag: "NoOp" as const, name: `${uksVolumeRow(entry.name)} (retained)` }
        : { _tag: "Delete" as const, name: uksVolumeRow(entry.name) }
    )
    return [...bucketActions, ...volumeActions, clusterAction, ...poolActions, ...networkActions]
  })
