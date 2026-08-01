import { configHash } from "@kumulo/core"
import type { UksWorkerPoolConfig } from "./types.ts"

export interface ExistingNodeGroup {
  readonly name: string
  readonly count: number
  readonly poolLabel?: string | undefined
  readonly configHash?: string | undefined
}

export const KUMULO_POOL_LABEL_KEY = "kumulo-pool"

export const uksPoolHash = (pool: UksWorkerPoolConfig): string =>
  configHash({
    plan: pool.plan,
    labels: pool.labels ?? [],
    taints: pool.taints ?? [],
    ssh_keys: pool.ssh_keys ?? [],
    storage: pool.storage,
    anti_affinity: pool.anti_affinity ?? false,
    utility_network_access: pool.utility_network_access ?? false
  })

export const uksPoolName = (pool: UksWorkerPoolConfig): string => `${pool.name}-${uksPoolHash(pool).slice(0, 8)}`

export interface NodeGroupDiff {
  readonly toCreate: ReadonlyArray<UksWorkerPoolConfig>
  readonly toReplace: ReadonlyArray<{ readonly liveName: string; readonly pool: UksWorkerPoolConfig }>
  readonly toUpdate: ReadonlyArray<{ readonly liveName: string; readonly pool: UksWorkerPoolConfig }>
  readonly toDelete: ReadonlyArray<string>
}

const NO_REPLACE: ReadonlySet<string> = new Set()

// replace requires explicit confirmation — running two generations
// concurrently is a double-billing window, never inferred automatically.
export const diffNodePools = (
  { desired, existing, replace = NO_REPLACE }: {
    readonly desired: ReadonlyArray<UksWorkerPoolConfig>
    readonly existing: ReadonlyArray<ExistingNodeGroup>
    readonly replace?: ReadonlySet<string>
  }
): NodeGroupDiff => {
  const byPoolLabel = _groupByPoolLabel(existing)
  const desiredPoolNames = new Set(desired.map((pool) => pool.name))
  const stale: Array<string> = []

  const toCreate: Array<UksWorkerPoolConfig> = []
  const toReplace: Array<{ readonly liveName: string; readonly pool: UksWorkerPoolConfig }> = []
  const toUpdate: Array<{ readonly liveName: string; readonly pool: UksWorkerPoolConfig }> = []

  for (const pool of desired) {
    const generations = byPoolLabel.get(pool.name) ?? []
    const match = _liveGeneration(generations, uksPoolHash(pool))
    const confirmed = replace.has(pool.name)
    if (!match) {
      toCreate.push(pool)
      if (confirmed) stale.push(...generations.map((group) => group.name))
    } else if (match.configHash !== uksPoolHash(pool)) {
      if (confirmed) {
        toReplace.push({ liveName: match.name, pool })
        stale.push(...generations.filter((group) => group.name !== match.name).map((group) => group.name))
      }
    } else {
      if (pool.count !== match.count) toUpdate.push({ liveName: match.name, pool })
      stale.push(...generations.filter((group) => group.name !== match.name).map((group) => group.name))
    }
  }

  const undesired = existing
    .filter((group) => group.poolLabel !== undefined && !desiredPoolNames.has(group.poolLabel))
    .map((group) => group.name)
  return { toCreate, toReplace, toUpdate, toDelete: [...undesired, ...stale] }
}

const _groupByPoolLabel = (existing: ReadonlyArray<ExistingNodeGroup>): Map<string, Array<ExistingNodeGroup>> => {
  const byLabel = new Map<string, Array<ExistingNodeGroup>>()
  for (const group of existing) {
    if (group.poolLabel === undefined) continue
    const bucket = byLabel.get(group.poolLabel)
    if (bucket) bucket.push(group)
    else byLabel.set(group.poolLabel, [group])
  }
  return byLabel
}

const _liveGeneration = (
  generations: ReadonlyArray<ExistingNodeGroup>,
  desiredHash: string
): ExistingNodeGroup | undefined =>
  generations.find((group) => group.configHash === desiredHash) ??
    generations.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))[0]
