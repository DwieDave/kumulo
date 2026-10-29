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

const _isImmutableDiff = (spec: BunnyBucketSpec, existing: ExistingBunnyBucket): boolean =>
  spec.region !== existing.region || (spec.tier ?? "standard") !== existing.tier

export const diffBuckets = (
  { desired, existing }: {
    readonly desired: ReadonlyArray<BunnyBucketSpec>
    readonly existing: ReadonlyArray<ExistingBunnyBucket>
  }
): BunnyBucketDiff => {
  const byName = new Map(existing.map((bucket) => [bucket.name, bucket]))
  const desiredNames = new Set(desired.map((bucket) => bucket.name))

  const toCreate: Array<BunnyBucketSpec> = []
  const toReplace: Array<{ readonly ref: BucketRef; readonly spec: BunnyBucketSpec }> = []
  const noop: Array<BucketRef> = []

  for (const spec of desired) {
    const match = byName.get(spec.name)

    if (!match) toCreate.push(spec)
    else if (_isImmutableDiff(spec, match)) toReplace.push({ ref: _toRef(match), spec })
    else noop.push(_toRef(match))
  }

  const toDelete = existing.flatMap((bucket) => (desiredNames.has(bucket.name) || bucket.retain ? [] : [_toRef(bucket)]))

  return { toCreate, toReplace, toDelete, noop }
}
