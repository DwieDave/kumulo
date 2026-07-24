import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { diffBuckets } from "../src/diff.ts"
import type { ExistingBucket } from "../src/diff.ts"
import type { BucketSpec } from "@kumulo/core"

const _bucketArb = fc.record({
  name: fc.constantFrom("staging-eu-backups", "prod-logs", "archive"),
  region: fc.constantFrom("DE1", "GRA"),
  versioning: fc.boolean(),
  encryption: fc.boolean(),
  retain: fc.boolean()
})

const _toExisting = (bucket: BucketSpec): ExistingBucket => ({ ...bucket })

describe("diffBuckets", () => {
  it.prop("re-diffing a converged state is a no-op", [fc.array(_bucketArb, { maxLength: 4 })], ([buckets]) => {
    // de-dupe by name — buckets are keyed that way.
    const desired = [...new Map(buckets.map((bucket) => [bucket.name, bucket])).values()]
    const existing = desired.map(_toExisting)
    const diff = diffBuckets({ desired, existing })
    return diff.toCreate.length === 0 && diff.toReplace.length === 0 && diff.toUpdate.length === 0 &&
      diff.toDelete.length === 0
  })

  it.prop(
    "every desired bucket appears in exactly one of create/replace/update/noop",
    [fc.array(_bucketArb, { maxLength: 4 }), fc.array(_bucketArb, { maxLength: 4 })],
    ([desiredRaw, existingRaw]) => {
      const desired = [...new Map(desiredRaw.map((bucket) => [bucket.name, bucket])).values()]
      const existing = [...new Map(existingRaw.map((bucket) => [bucket.name, bucket])).values()].map(_toExisting)
      const diff = diffBuckets({ desired, existing })
      const buckets = [
        ...diff.toCreate.map((b) => b.name),
        ...diff.toReplace.map((b) => b.spec.name),
        ...diff.toUpdate.map((b) => b.spec.name),
        ...diff.noop.map((b) => b.name)
      ]
      return desired.every((bucket) => buckets.filter((name) => name === bucket.name).length === 1) &&
        buckets.length === desired.length
    }
  )

  it.prop(
    "a retained existing bucket is never in toDelete",
    [fc.array(_bucketArb, { maxLength: 4 })],
    ([existingRaw]) => {
      const existing = [...new Map(existingRaw.map((bucket) => [bucket.name, bucket])).values()].map(_toExisting)
      const diff = diffBuckets({ desired: [], existing })
      const retainedNames = new Set(existing.filter((bucket) => bucket.retain).map((bucket) => bucket.name))
      return diff.toDelete.every((ref) => !retainedNames.has(ref.name))
    }
  )

  it("creates buckets missing from existing state", () => {
    const desired: ReadonlyArray<BucketSpec> = [
      { name: "staging-eu-backups", region: "DE1", versioning: false, encryption: false, retain: true }
    ]
    const diff = diffBuckets({ desired, existing: [] })
    expect(diff.toCreate).toEqual(desired)
    expect(diff.toDelete).toEqual([])
  })

  it("deletes non-retained buckets absent from desired state", () => {
    const existing: ReadonlyArray<ExistingBucket> = [
      { name: "orphan", region: "DE1", versioning: false, encryption: false, retain: false }
    ]
    const diff = diffBuckets({ desired: [], existing })
    expect(diff.toDelete).toEqual([{ name: "orphan", region: "DE1" }])
  })

  it("keeps a retained bucket absent from desired state out of toDelete", () => {
    const existing: ReadonlyArray<ExistingBucket> = [
      { name: "orphan", region: "DE1", versioning: false, encryption: false, retain: true }
    ]
    const diff = diffBuckets({ desired: [], existing })
    expect(diff.toDelete).toEqual([])
  })

  it("replaces on immutable drift (region/encryption), updates on mutable drift (versioning)", () => {
    const existing: ReadonlyArray<ExistingBucket> = [
      { name: "staging-eu-backups", region: "DE1", versioning: false, encryption: false, retain: true }
    ]
    const replaced = diffBuckets({
      desired: [{ ...existing[0]!, encryption: true }],
      existing
    })
    expect(replaced.toReplace).toHaveLength(1)
    expect(replaced.toUpdate).toEqual([])

    const updated = diffBuckets({
      desired: [{ ...existing[0]!, versioning: true }],
      existing
    })
    expect(updated.toUpdate).toHaveLength(1)
    expect(updated.toReplace).toEqual([])
  })
})
