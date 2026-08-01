import { configHash } from "@kumulo/core"
import type { MksWorkerPoolConfig } from "./types.ts"

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
  readonly configHash?: string | undefined
}

export const mksPoolHash = (pool: MksWorkerPoolConfig): string =>
  configHash({ flavor: pool.flavor, antiAffinity: pool.antiAffinity, monthlyBilled: pool.monthlyBilled })

export interface NodePoolDiff {
  readonly toCreate: ReadonlyArray<MksWorkerPoolConfig>
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

// replace is only ever applied for pool names the operator confirmed — never inferred, since it's destructive
export const diffNodePools = (
  { desired, existing, replace = NO_REPLACE }: {
    readonly desired: ReadonlyArray<MksWorkerPoolConfig>
    readonly existing: ReadonlyArray<ExistingNodePool>
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
      if (replace.has(pool.name)) toReplace.push({ id: match.id, pool })
    } else if (_isMutableDiff(pool, match)) {
      toUpdate.push({ id: match.id, pool })
    }
  }

  const toDelete = existing.filter((pool) => !desiredNames.has(pool.name)).map((pool) => pool.id)
  return { toCreate, toReplace, toUpdate, toDelete }
}
