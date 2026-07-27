import type { Plan, PlanAction } from "@kumulo/core"
import { mksPoolHash, type MksWorkerPoolConfig } from "@kumulo/distro-ovh-mks"
import { type DnsPlanInput, dnsPlanActions } from "../dns-plan.ts"

/** Structural slice of a `ClusterConfig` worker pool — enough to build the MKS pool spec. */
export interface MksPoolInput {
  readonly name: string
  readonly flavor: string
  readonly count: number
  readonly autoscaling?: { readonly enabled: boolean; readonly min: number; readonly max: number }
}

// Structural slice of `ClusterConfig` (same pattern as core's
// `ClusterConfigShape`) — keeps this module's test fixtures minimal instead
// of requiring a full config object.
export interface MksPlanInput {
  readonly name: string
  readonly worker_pools: ReadonlyArray<MksPoolInput>
  readonly volumes:
    | { readonly module: "none" }
    | { readonly module: "cinder" | "hcloud"; readonly managed: ReadonlyArray<{ readonly name: string }> }
  // Optional so existing plan fixtures stay minimal; a real `ClusterConfig`
  // always carries it.
  readonly dns?: DnsPlanInput
}

/** The one place a config worker pool becomes an MKS nodepool spec — plan and apply must hash the same value. */
export const toMksPool = (pool: MksPoolInput): MksWorkerPoolConfig => ({
  name: pool.name,
  flavor: pool.flavor,
  desiredNodes: pool.count,
  minNodes: pool.autoscaling?.enabled ? pool.autoscaling.min : pool.count,
  maxNodes: pool.autoscaling?.enabled ? pool.autoscaling.max : pool.count,
  autoscale: pool.autoscaling?.enabled ?? false,
  antiAffinity: true,
  monthlyBilled: false
})

/** Plan row names — shared with the reconciler, which maps a confirmed row back to its pool. */
export const mksClusterRow = (cluster: string): string => `mks-cluster/${cluster}`
export const mksPoolRow = (
  { cluster, pool }: { readonly cluster: string; readonly pool: string }
): string => `mks-pool/${cluster}/${pool}`

/** Live existence, as looked up right before planning (see `lookupMksInventory`). */
export interface MksInventory {
  readonly clusterExists: boolean
  readonly poolNames: ReadonlySet<string>
  readonly volumeNames: ReadonlySet<string>
  /**
   * Pool name → the config hash stamped on it (`undefined` for a pool created
   * before stamping). `poolNames` stays the existence view its other readers
   * use; this adds the drift view.
   */
  readonly poolHashes?: ReadonlyMap<string, string | undefined>
}

export const emptyMksInventory: MksInventory = {
  clusterExists: false,
  poolNames: new Set(),
  volumeNames: new Set()
}

const _createOrNoOp = ({ exists, name }: { readonly exists: boolean; readonly name: string }): PlanAction =>
  exists ? { _tag: "NoOp", name } : { _tag: "Create", name }

/**
 * Same rule as core's `computePlan` (plan/diff.ts), applied to MKS node pools:
 * absent → Create, no stamped hash → NoOp (the pool exists, and we cannot
 * honestly tell it drifted), hash equal → NoOp, hash differs →
 * `ReplaceNeedsConfirm`. Only the immutable fields are hashed
 * (`mksPoolHash`), so scaling still converges as an in-place update.
 */
const _poolAction = (
  { cluster, inventory, pool }: {
    readonly cluster: string
    readonly inventory: MksInventory
    readonly pool: MksPoolInput
  }
): PlanAction => {
  const name = mksPoolRow({ cluster, pool: pool.name })
  const exists = inventory.clusterExists && inventory.poolNames.has(pool.name)
  if (!exists) return { _tag: "Create", name }
  const actual = inventory.poolHashes?.get(pool.name)
  return actual === undefined || actual === mksPoolHash(toMksPool(pool))
    ? { _tag: "NoOp", name }
    : { _tag: "ReplaceNeedsConfirm", name, reason: "config-hash drifted from desired spec" }
}

export const buildMksPlan = (
  { config, inventory }: { readonly config: MksPlanInput; readonly inventory: MksInventory }
): Plan => ({
  actions: [
    _createOrNoOp({ exists: inventory.clusterExists, name: mksClusterRow(config.name) }),
    ...config.worker_pools.map((pool) => _poolAction({ cluster: config.name, inventory, pool })),
    ...(config.volumes.module === "cinder"
      ? config.volumes.managed.map((v) => _createOrNoOp({ exists: inventory.volumeNames.has(v.name), name: `volume/${v.name}` }))
      : []),
    // MKS exposes the api server as a hostname → CNAME (see `applyMks`).
    ...(config.dns === undefined ? [] : dnsPlanActions({ config: config.dns, targetKind: "hostname" }))
  ]
})
