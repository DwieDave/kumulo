import { configHash } from "@kumulo/core"
import type { UksWorkerPoolConfig } from "./types.ts"

/** Node group state as read back from UpCloud's API, by `kumulo-pool` label-keyed (D9). */
export interface ExistingNodeGroup {
  /** The live, API-visible name — `<pool>-<hash8>` (D9). */
  readonly name: string
  readonly count: number
  /** Stamped under `KUMULO_POOL_LABEL_KEY`; absent on groups created outside kumulo. */
  readonly poolLabel?: string | undefined
  /** Stamped under `CONFIG_HASH_KEY`; absent on groups created outside kumulo. */
  readonly configHash?: string | undefined
}

/** The label kumulo stamps a node group's pool identity under (D9) — see also T4.5's ownership labels. */
export const KUMULO_POOL_LABEL_KEY = "kumulo-pool"

/**
 * The drift hash a node group is stamped with — only the fields
 * `PATCH node-groups/{name}` cannot change (D8: everything except `count`),
 * so scaling still converges as an `Update` instead of demanding a replace
 * confirmation.
 */
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

/**
 * D9's live-name scheme: node group names are unique per cluster and cannot
 * be renamed, so the API-visible name embeds the immutable-field hash. A
 * confirmed replace (new hash) therefore creates a group under a new name
 * before the old one is deleted — never a rename in place.
 */
export const uksPoolName = (pool: UksWorkerPoolConfig): string => `${pool.name}-${uksPoolHash(pool).slice(0, 8)}`

export interface NodeGroupDiff {
  readonly toCreate: ReadonlyArray<UksWorkerPoolConfig>
  // Everything but `count` is immutable on UpCloud's node-group API (D8) —
  // a change there can only be realized as create-then-delete (D9).
  readonly toReplace: ReadonlyArray<{ readonly liveName: string; readonly pool: UksWorkerPoolConfig }>
  readonly toUpdate: ReadonlyArray<{ readonly liveName: string; readonly pool: UksWorkerPoolConfig }>
  readonly toDelete: ReadonlyArray<string>
}

const NO_REPLACE: ReadonlySet<string> = new Set()

// kumulo: `worker_pools` converge onto UKS node groups keyed on the
// `kumulo-pool` LABEL, not the API name — D9's consequence of the live name
// carrying a hash suffix that changes on immutable drift. Missing → create,
// present-with-immutable-drift → replace *only when the operator confirmed
// that pool's name* (a replace is destructive and runs two generations of
// the group concurrently — D9's double-billing window — so it is never
// inferred here), present-with-count-drift → update, present-but-undesired
// → delete. Pure and total: same inputs always produce the same plan
// (idempotent re-run, easy to property-test).
export const diffNodePools = (
  { desired, existing, replace = NO_REPLACE }: {
    readonly desired: ReadonlyArray<UksWorkerPoolConfig>
    readonly existing: ReadonlyArray<ExistingNodeGroup>
    /** Pool names the operator confirmed for replacement (plan `ReplaceNeedsConfirm` rows). */
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
      // Nothing carries the desired hash. Every generation present is stale,
      // but reclaiming it is destructive, so it waits for confirmation exactly
      // as an in-place replace does.
      if (confirmed) stale.push(...generations.map((group) => group.name))
    } else if (match.configHash !== uksPoolHash(pool)) {
      // Unconfirmed immutable drift is left strictly alone — the plan showed
      // it as `ReplaceNeedsConfirm` and the CLI fails closed before apply.
      // The replace tears down `match` itself; siblings need saying so.
      if (confirmed) {
        toReplace.push({ liveName: match.name, pool })
        stale.push(...generations.filter((group) => group.name !== match.name).map((group) => group.name))
      }
    } else {
      if (pool.count !== match.count) toUpdate.push({ liveName: match.name, pool })
      // The desired generation is live, so any sibling sharing its label is a
      // replace that died between create and delete (D9). It is billed and
      // invisible to a by-name sweep — reclaim it without a fresh confirmation,
      // since the replace that created it was already confirmed once.
      stale.push(...generations.filter((group) => group.name !== match.name).map((group) => group.name))
    }
  }

  // Groups with no `kumulo-pool` label were never created by kumulo (or
  // predate the stamp) — never deleted, same "leave unmanaged state alone"
  // stance as unconfirmed immutable drift above.
  const undesired = existing
    .filter((group) => group.poolLabel !== undefined && !desiredPoolNames.has(group.poolLabel))
    .map((group) => group.name)
  return { toCreate, toReplace, toUpdate, toDelete: [...undesired, ...stale] }
}

/**
 * Live groups bucketed by their `kumulo-pool` label. A label maps to a *list*,
 * not a single group: an interrupted replace (D9 creates before it deletes)
 * leaves two generations wearing the same label, and a `Map` keyed on it would
 * silently keep whichever the API happened to list last — stranding the other
 * as a billed resource no sweep can see.
 */
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

/** The generation carrying the desired hash, else the name-first one, so the choice never depends on API list order. */
const _liveGeneration = (
  generations: ReadonlyArray<ExistingNodeGroup>,
  desiredHash: string
): ExistingNodeGroup | undefined =>
  generations.find((group) => group.configHash === desiredHash) ??
    generations.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))[0]
