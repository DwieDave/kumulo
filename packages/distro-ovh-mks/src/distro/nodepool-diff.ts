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
}

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

// kumulo: `worker_pools` converge onto MKS nodepools by name: missing →
// create, present-with-immutable-drift → replace, present-with-mutable-drift
// → update, present-but-undesired → delete. Pure and total: same inputs
// always produce the same plan (idempotent re-run, easy to property-test).
export const diffNodePools = (
  { desired, existing }: {
    readonly desired: ReadonlyArray<MksWorkerPoolConfig>
    readonly existing: ReadonlyArray<ExistingNodePool>
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
      toReplace.push({ id: match.id, pool })
    } else if (_isMutableDiff(pool, match)) {
      toUpdate.push({ id: match.id, pool })
    }
  }

  const toDelete = existing.filter((pool) => !desiredNames.has(pool.name)).map((pool) => pool.id)
  return { toCreate, toReplace, toUpdate, toDelete }
}
