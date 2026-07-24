import type { BucketRef, BucketSpec } from "@kumulo/core"

/** Bucket state as read back for reconcile (§R5/R7), by-name-keyed — `retain` carries over from the last recorded desired state, not the OVH API. */
export interface ExistingBucket {
  readonly name: string
  readonly region: string
  readonly versioning: boolean
  readonly encryption: boolean
  readonly retain: boolean
}

export interface BucketDiff {
  readonly toCreate: ReadonlyArray<BucketSpec>
  // region/encryption are immutable on OVH's side — a change there can only
  // be realized as delete-then-recreate.
  readonly toReplace: ReadonlyArray<{ readonly ref: BucketRef; readonly spec: BucketSpec }>
  readonly toUpdate: ReadonlyArray<{ readonly ref: BucketRef; readonly spec: BucketSpec }>
  readonly toDelete: ReadonlyArray<BucketRef>
  readonly noop: ReadonlyArray<BucketRef>
}

const _isImmutableDiff = (bucket: BucketSpec, existing: ExistingBucket): boolean =>
  bucket.region !== existing.region || bucket.encryption !== existing.encryption

const _isMutableDiff = (bucket: BucketSpec, existing: ExistingBucket): boolean => bucket.versioning !== existing.versioning

const _toRef = (bucket: ExistingBucket): BucketRef => ({ name: bucket.name, region: bucket.region })

// kumulo: `object_storage.buckets` converge onto OVH containers by name:
// missing → create, present-with-immutable-drift → replace,
// present-with-mutable-drift → update, present-and-matching → noop,
// present-but-undesired → delete (unless retained, R6). Pure and total: same
// inputs always produce the same plan (idempotent re-run, property-tested).
export const diffBuckets = (
  { desired, existing }: {
    readonly desired: ReadonlyArray<BucketSpec>
    readonly existing: ReadonlyArray<ExistingBucket>
  }
): BucketDiff => {
  const byName = new Map(existing.map((bucket) => [bucket.name, bucket]))
  const desiredNames = new Set(desired.map((bucket) => bucket.name))

  const toCreate: Array<BucketSpec> = []
  const toReplace: Array<{ readonly ref: BucketRef; readonly spec: BucketSpec }> = []
  const toUpdate: Array<{ readonly ref: BucketRef; readonly spec: BucketSpec }> = []
  const noop: Array<BucketRef> = []

  for (const bucket of desired) {
    const match = byName.get(bucket.name)
    if (!match) {
      toCreate.push(bucket)
    } else if (_isImmutableDiff(bucket, match)) {
      toReplace.push({ ref: _toRef(match), spec: bucket })
    } else if (_isMutableDiff(bucket, match)) {
      toUpdate.push({ ref: _toRef(match), spec: bucket })
    } else {
      noop.push(_toRef(match))
    }
  }

  const toDelete = existing
    .filter((bucket) => !desiredNames.has(bucket.name) && !bucket.retain)
    .map(_toRef)

  return { toCreate, toReplace, toUpdate, toDelete, noop }
}
