import { configHash } from "@kumulo/core"
import type { MksWorkerPoolConfig } from "./types.ts"

/** Node pool state as read back from the OVH API (§3.3.1), by-name-keyed. */
export interface ExistingNodePool {
  readonly id: string
  readonly name: string
  readonly flavor: string
  readonly desiredNodes: number
  readonly minNodes: number
  readonly maxNodes: number
  readonly autoscale: boolean
  readonly antiAffinity: boolean
  readonly monthlyBilled: boolean
  /** Stamped under `CONFIG_HASH_KEY` in the pool template's annotations; absent on pools created before stamping. */
  readonly configHash?: string | undefined
}

/**
 * The drift hash a nodepool is stamped with — only the fields OVH cannot
 * change in place, so scaling (desired/min/max/autoscale) still converges as
 * an `Update` instead of demanding a replace confirmation.
 */
export const mksPoolHash = (pool: MksWorkerPoolConfig): string =>
  configHash({ flavor: pool.flavor, antiAffinity: pool.antiAffinity, monthlyBilled: pool.monthlyBilled })

export interface NodePoolDiff {
  readonly toCreate: ReadonlyArray<MksWorkerPoolConfig>
  // flavor/antiAffinity/monthlyBilled are immutable on OVH's nodepool API —
  // a change there can only be realized as delete-then-recreate.
  readonly toReplace: ReadonlyArray<{ readonly id: string; readonly pool: MksWorkerPoolConfig }>
  readonly toUpdate: ReadonlyArray<{ readonly id: string; readonly pool: MksWorkerPoolConfig }>
  readonly toDelete: ReadonlyArray<string>
}

const _isImmutableDiff = (pool: MksWorkerPoolConfig, existing: ExistingNodePool): boolean =>
  pool.flavor !== existing.flavor ||
  pool.antiAffinity !== existing.antiAffinity ||
  pool.monthlyBilled !== existing.monthlyBilled

const _isMutableDiff = (pool: MksWorkerPoolConfig, existing: ExistingNodePool): boolean =>
  pool.desiredNodes !== existing.desiredNodes ||
  pool.minNodes !== existing.minNodes ||
  pool.maxNodes !== existing.maxNodes ||
  pool.autoscale !== existing.autoscale

const NO_REPLACE: ReadonlySet<string> = new Set()

// kumulo: `worker_pools` converge onto MKS nodepools by name: missing →
// create, present-with-immutable-drift → replace *only when the operator
// confirmed that pool's name* (same rule as the k3s node path — a replace is
// destructive, so it is never inferred here), present-with-mutable-drift →
// update, present-but-undesired → delete. Pure and total: same inputs
// always produce the same plan (idempotent re-run, easy to property-test).
export const diffNodePools = (
  { desired, existing, replace = NO_REPLACE }: {
    readonly desired: ReadonlyArray<MksWorkerPoolConfig>
    readonly existing: ReadonlyArray<ExistingNodePool>
    /** Pool names the operator confirmed for replacement (plan `ReplaceNeedsConfirm` rows). */
    readonly replace?: ReadonlySet<string>
  }
): NodePoolDiff => {
  const byName = new Map(existing.map((pool) => [pool.name, pool]))
  const desiredNames = new Set(desired.map((pool) => pool.name))

  const toCreate: Array<MksWorkerPoolConfig> = []
  const toReplace: Array<{ readonly id: string; readonly pool: MksWorkerPoolConfig }> = []
  const toUpdate: Array<{ readonly id: string; readonly pool: MksWorkerPoolConfig }> = []

  for (const pool of desired) {
    const match = byName.get(pool.name)
    if (!match) {
      toCreate.push(pool)
    } else if (_isImmutableDiff(pool, match)) {
      // Unconfirmed immutable drift is left strictly alone — the plan showed
      // it as `ReplaceNeedsConfirm` and the CLI fails closed before apply.
      if (replace.has(pool.name)) toReplace.push({ id: match.id, pool })
    } else if (_isMutableDiff(pool, match)) {
      toUpdate.push({ id: match.id, pool })
    }
  }

  const toDelete = existing.filter((pool) => !desiredNames.has(pool.name)).map((pool) => pool.id)
  return { toCreate, toReplace, toUpdate, toDelete }
}
