import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { diffNodePools, uksPoolHash, uksPoolName } from "../../src/distro/nodegroup-diff.ts"
import type { ExistingNodeGroup } from "../../src/distro/nodegroup-diff.ts"
import type { UksWorkerPoolConfig } from "../../src/distro/types.ts"

const _poolArb = fc.record({
  name: fc.constantFrom("workers", "spot", "batch"),
  plan: fc.constantFrom("2xCPU-4GB", "4xCPU-8GB"),
  count: fc.integer({ min: 0, max: 10 }),
  anti_affinity: fc.boolean()
})

const _toExisting = (pool: UksWorkerPoolConfig): ExistingNodeGroup => ({
  name: uksPoolName(pool),
  count: pool.count,
  poolLabel: pool.name,
  configHash: uksPoolHash(pool)
})

describe("diffNodePools", () => {
  it.prop("re-diffing a converged state is a no-op", [fc.array(_poolArb, { maxLength: 4 })], ([pools]) => {
    // de-dupe by name — the config itself is keyed that way.
    const desired = [...new Map(pools.map((pool) => [pool.name, pool])).values()]
    const existing = desired.map(_toExisting)
    const diff = diffNodePools({ desired, existing })
    return diff.toCreate.length === 0 && diff.toReplace.length === 0 && diff.toUpdate.length === 0 &&
      diff.toDelete.length === 0
  })

  it("applying a diff and re-diffing (with confirmed replaces materialized) converges to empty", () => {
    fc.assert(
      fc.property(fc.array(_poolArb, { maxLength: 4 }), fc.array(_poolArb, { maxLength: 4 }), (before, after) => {
        const desiredBefore = [...new Map(before.map((pool) => [pool.name, pool])).values()]
        const desiredAfter = [...new Map(after.map((pool) => [pool.name, pool])).values()]
        const existingBefore = desiredBefore.map(_toExisting)

        // Apply desiredAfter against existingBefore, confirming every pool
        // name up front so immutable drift always materializes as a replace.
        const confirmed = new Set(desiredAfter.map((pool) => pool.name))
        const diff = diffNodePools({ desired: desiredAfter, existing: existingBefore, replace: confirmed })

        // Simulate the apply: created/replaced pools land at their new hash
        // and count; updated pools keep their live name but new count;
        // deleted/replaced-away live names drop out.
        const deletedNames = new Set(diff.toDelete)
        const replacedLiveNames = new Set(diff.toReplace.map((row) => row.liveName))
        const survivors = existingBefore.filter((group) => !deletedNames.has(group.name) && !replacedLiveNames.has(group.name))
        const updatedByLiveName = new Map(diff.toUpdate.map((row) => [row.liveName, row.pool]))
        const applied = survivors.map((group) => {
          const update = updatedByLiveName.get(group.name)
          return update ? { ...group, count: update.count } : group
        })
        const created = [...diff.toCreate, ...diff.toReplace.map((row) => row.pool)].map(_toExisting)
        const converged = [...applied, ...created]

        const rediff = diffNodePools({ desired: desiredAfter, existing: converged })
        expect(rediff.toCreate).toEqual([])
        expect(rediff.toReplace).toEqual([])
        expect(rediff.toUpdate).toEqual([])
        expect(rediff.toDelete).toEqual([])
      })
    )
  })

  it("creates pools missing from existing state", () => {
    const desired: ReadonlyArray<UksWorkerPoolConfig> = [{ name: "workers", plan: "2xCPU-4GB", count: 3 }]
    const diff = diffNodePools({ desired, existing: [] })
    expect(diff.toCreate).toEqual(desired)
    expect(diff.toDelete).toEqual([])
  })

  it("deletes labelled groups absent from desired state; leaves unlabelled ones alone", () => {
    const labelled: ExistingNodeGroup = { name: "orphan-abcd1234", count: 1, poolLabel: "orphan", configHash: "x" }
    const unlabelled: ExistingNodeGroup = { name: "hand-made", count: 1 }
    const diff = diffNodePools({ desired: [], existing: [labelled, unlabelled] })
    expect(diff.toDelete).toEqual(["orphan-abcd1234"])
  })

  it("replaces on immutable drift (plan), updates on mutable drift (count)", () => {
    const pool: UksWorkerPoolConfig = { name: "workers", plan: "2xCPU-4GB", count: 3 }
    const existing: ReadonlyArray<ExistingNodeGroup> = [_toExisting(pool)]

    const replaced = diffNodePools({
      desired: [{ ...pool, plan: "4xCPU-8GB" }],
      existing,
      replace: new Set(["workers"])
    })
    expect(replaced.toReplace).toHaveLength(1)
    expect(replaced.toUpdate).toEqual([])

    // Unconfirmed immutable drift must not mutate anything at all.
    const unconfirmed = diffNodePools({ desired: [{ ...pool, plan: "4xCPU-8GB" }], existing })
    expect(unconfirmed.toReplace).toEqual([])
    expect(unconfirmed.toUpdate).toEqual([])
    expect(unconfirmed.toCreate).toEqual([])
    expect(unconfirmed.toDelete).toEqual([])

    const updated = diffNodePools({ desired: [{ ...pool, count: 9 }], existing })
    expect(updated.toUpdate).toHaveLength(1)
    expect(updated.toReplace).toEqual([])
  })
})

describe("diffNodePools with a duplicated pool label (interrupted replace)", () => {
  const _pool: UksWorkerPoolConfig = { name: "workers", plan: "2xCPU-4GB", count: 2 }
  const _stale: ExistingNodeGroup = {
    name: "workers-deadbeef",
    count: 2,
    poolLabel: "workers",
    configHash: "deadbeefdeadbeef"
  }

  // A replace that died between create and delete leaves two live groups
  // carrying the same `kumulo-pool` label. The stale generation is still
  // billed, and the desired name is present, so a by-name filter never
  // reclaims it.
  it("deletes the stale generation once the desired one exists", () => {
    const diff = diffNodePools({ desired: [_pool], existing: [_stale, _toExisting(_pool)] })
    expect(diff.toCreate).toHaveLength(0)
    expect(diff.toUpdate).toHaveLength(0)
    expect(diff.toReplace).toHaveLength(0)
    expect(diff.toDelete).toEqual([_stale.name])
  })

  it("leaves both alone when neither generation matches and the replace is unconfirmed", () => {
    const otherStale: ExistingNodeGroup = { ..._stale, name: "workers-cafebabe", configHash: "cafebabecafebabe" }
    const diff = diffNodePools({ desired: [_pool], existing: [_stale, otherStale] })
    expect(diff.toDelete).toHaveLength(0)
    expect(diff.toReplace).toHaveLength(0)
  })

  it("replaces once and reclaims every stale generation when confirmed", () => {
    const otherStale: ExistingNodeGroup = { ..._stale, name: "workers-cafebabe", configHash: "cafebabecafebabe" }
    const diff = diffNodePools({
      desired: [_pool],
      existing: [_stale, otherStale],
      replace: new Set(["workers"])
    })
    // The replaced generation is torn down by the replace itself, so only its
    // orphaned sibling belongs in toDelete — listing both would delete twice.
    expect(diff.toReplace).toHaveLength(1)
    const replaced = diff.toReplace[0]?.liveName
    const sibling = [_stale.name, otherStale.name].find((name) => name !== replaced)
    expect(diff.toDelete).toEqual([sibling])
  })
})
