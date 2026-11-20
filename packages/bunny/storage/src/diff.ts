import { diffBuckets as coreDiffBuckets } from "@kumulo/core"
import type { BucketRef } from "@kumulo/core"

export type BunnyTier = "standard" | "edge"

export interface BunnyBucketSpec {
  readonly name: string
  readonly region: string
  readonly tier?: BunnyTier | undefined
  readonly retain: boolean
}

export interface ExistingBunnyBucket {
  readonly id: number
  readonly name: string
  readonly region: string
  readonly tier: BunnyTier
  readonly retain: boolean
}

export interface BunnyBucketDiff {
  readonly toCreate: ReadonlyArray<BunnyBucketSpec>
  readonly toReplace: ReadonlyArray<{ readonly ref: BucketRef; readonly spec: BunnyBucketSpec }>
  readonly toDelete: ReadonlyArray<BucketRef>
  readonly noop: ReadonlyArray<BucketRef>
}

const _toRef = (bucket: ExistingBunnyBucket): BucketRef => ({ name: bucket.name, region: bucket.region })

// Region and tier cannot change in place, so any drift is a replace.
export const diffBuckets = (
  { desired, existing }: {
    readonly desired: ReadonlyArray<BunnyBucketSpec>
    readonly existing: ReadonlyArray<ExistingBunnyBucket>
  }
): BunnyBucketDiff => {
  const diff = coreDiffBuckets({
    desired,
    existing,
    isImmutable: (spec, current) => spec.region !== current.region || (spec.tier ?? "standard") !== current.tier
  })

  return {
    toCreate: diff.toCreate,
    toReplace: diff.toReplace.map(({ existing: current, spec }) => ({ ref: _toRef(current), spec })),
    toDelete: diff.toDelete.map(_toRef),
    noop: diff.noop.map(_toRef)
  }
}
