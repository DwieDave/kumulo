import { diffBuckets as diffBucketsCore } from "@kumulo/core"
import type { BucketRef, BucketSpec } from "@kumulo/core"

export interface ExistingBucket {
  readonly name: string
  readonly region: string
  readonly versioning: boolean
  readonly encryption: boolean
  readonly retain: boolean
}

export interface BucketDiff {
  readonly toCreate: ReadonlyArray<BucketSpec>
  // region/encryption drift is realized as delete-then-recreate (immutable on OVH's side)
  readonly toReplace: ReadonlyArray<{ readonly ref: BucketRef; readonly spec: BucketSpec }>
  readonly toUpdate: ReadonlyArray<{ readonly ref: BucketRef; readonly spec: BucketSpec }>
  readonly toDelete: ReadonlyArray<BucketRef>
  readonly noop: ReadonlyArray<BucketRef>
}

const _toRef = (bucket: ExistingBucket): BucketRef => ({ name: bucket.name, region: bucket.region })

export const diffBuckets = (
  { desired, existing }: {
    readonly desired: ReadonlyArray<BucketSpec>
    readonly existing: ReadonlyArray<ExistingBucket>
  }
): BucketDiff => {
  const diff = diffBucketsCore({
    desired,
    existing,
    isImmutable: (spec, current) => spec.region !== current.region || spec.encryption !== current.encryption,
    isMutable: (spec, current) => spec.versioning !== current.versioning
  })

  return {
    toCreate: diff.toCreate,
    toReplace: diff.toReplace.map(({ existing: current, spec }) => ({ ref: _toRef(current), spec })),
    toUpdate: diff.toUpdate.map(({ existing: current, spec }) => ({ ref: _toRef(current), spec })),
    toDelete: diff.toDelete.map(_toRef),
    noop: diff.noop.map(_toRef)
  }
}
