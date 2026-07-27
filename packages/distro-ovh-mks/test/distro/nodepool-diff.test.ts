import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { diffNodePools } from "../../src/distro/nodepool-diff.ts"
import type { ExistingNodePool } from "../../src/distro/nodepool-diff.ts"
import type { MksWorkerPoolConfig } from "../../src/distro/types.ts"

const _poolArb = fc.record({
  name: fc.constantFrom("workers", "spot", "batch"),
  flavor: fc.constantFrom("b2-7", "b2-15"),
  desiredNodes: fc.integer({ min: 0, max: 10 }),
  minNodes: fc.integer({ min: 0, max: 10 }),
  maxNodes: fc.integer({ min: 0, max: 10 }),
  autoscale: fc.boolean(),
  antiAffinity: fc.boolean(),
  monthlyBilled: fc.boolean()
})

const _toExisting = (pool: MksWorkerPoolConfig, id: string): ExistingNodePool => ({ ...pool, id })

describe("diffNodePools", () => {
  it.prop("re-diffing a converged state is a no-op", [fc.array(_poolArb, { maxLength: 4 })], ([pools]) => {
    // de-dupe by name — the API itself is keyed that way.
    const desired = [...new Map(pools.map((pool) => [pool.name, pool])).values()]
    const existing = desired.map((pool, i) => _toExisting(pool, `id-${i}`))
    const diff = diffNodePools({ desired, existing })
    return diff.toCreate.length === 0 && diff.toReplace.length === 0 && diff.toUpdate.length === 0 &&
      diff.toDelete.length === 0
  })

  it("creates pools missing from existing state", () => {
    const desired: ReadonlyArray<MksWorkerPoolConfig> = [
      { name: "workers", flavor: "b2-7", desiredNodes: 3, minNodes: 1, maxNodes: 5, autoscale: true, antiAffinity: true, monthlyBilled: false }
    ]
    const diff = diffNodePools({ desired, existing: [] })
    expect(diff.toCreate).toEqual(desired)
    expect(diff.toDelete).toEqual([])
  })

  it("deletes pools absent from desired state", () => {
    const existing: ReadonlyArray<ExistingNodePool> = [
      {
        id: "pool-1",
        name: "orphan",
        flavor: "b2-7",
        desiredNodes: 1,
        minNodes: 1,
        maxNodes: 1,
        autoscale: false,
        antiAffinity: false,
        monthlyBilled: false
      }
    ]
    const diff = diffNodePools({ desired: [], existing })
    expect(diff.toDelete).toEqual(["pool-1"])
  })

  it("replaces on immutable drift (flavor), updates on mutable drift (desiredNodes)", () => {
    const pool: ExistingNodePool = {
      id: "pool-1",
      name: "workers",
      flavor: "b2-7",
      desiredNodes: 3,
      minNodes: 1,
      maxNodes: 5,
      autoscale: true,
      antiAffinity: true,
      monthlyBilled: false
    }
    const existing: ReadonlyArray<ExistingNodePool> = [pool]
    const replaced = diffNodePools({
      desired: [{ ...pool, flavor: "b2-15" }],
      existing,
      replace: new Set(["workers"])
    })
    expect(replaced.toReplace).toHaveLength(1)
    expect(replaced.toUpdate).toEqual([])

    // Unconfirmed immutable drift must not mutate anything at all.
    const unconfirmed = diffNodePools({ desired: [{ ...pool, flavor: "b2-15" }], existing })
    expect(unconfirmed.toReplace).toEqual([])
    expect(unconfirmed.toUpdate).toEqual([])
    expect(unconfirmed.toCreate).toEqual([])
    expect(unconfirmed.toDelete).toEqual([])

    const updated = diffNodePools({
      desired: [{ ...pool, desiredNodes: 4 }],
      existing
    })
    expect(updated.toUpdate).toHaveLength(1)
    expect(updated.toReplace).toEqual([])
  })
})
