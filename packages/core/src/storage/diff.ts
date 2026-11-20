export interface BucketDiffResult<Spec, Existing> {
  readonly toCreate: ReadonlyArray<Spec>
  readonly toReplace: ReadonlyArray<{ readonly existing: Existing; readonly spec: Spec }>
  readonly toUpdate: ReadonlyArray<{ readonly existing: Existing; readonly spec: Spec }>
  readonly toDelete: ReadonlyArray<Existing>
  readonly noop: ReadonlyArray<Existing>
}

// Existing buckets absent from desired are deleted unless retained; immutable drift wins over mutable drift.
export const diffBuckets = <Spec extends { readonly name: string }, Existing extends { readonly name: string; readonly retain: boolean }>(
  { desired, existing, isImmutable, isMutable }: {
    readonly desired: ReadonlyArray<Spec>
    readonly existing: ReadonlyArray<Existing>
    readonly isImmutable: (spec: Spec, existing: Existing) => boolean
    readonly isMutable?: (spec: Spec, existing: Existing) => boolean
  }
): BucketDiffResult<Spec, Existing> => {
  const byName = new Map(existing.map((bucket) => [bucket.name, bucket]))
  const desiredNames = new Set(desired.map((bucket) => bucket.name))

  const toCreate: Array<Spec> = []
  const toReplace: Array<{ readonly existing: Existing; readonly spec: Spec }> = []
  const toUpdate: Array<{ readonly existing: Existing; readonly spec: Spec }> = []
  const noop: Array<Existing> = []

  for (const spec of desired) {
    const match = byName.get(spec.name)

    if (!match) toCreate.push(spec)
    else if (isImmutable(spec, match)) toReplace.push({ existing: match, spec })
    else if (isMutable?.(spec, match) === true) toUpdate.push({ existing: match, spec })
    else noop.push(match)
  }

  const toDelete = existing.filter((bucket) => !desiredNames.has(bucket.name) && !bucket.retain)

  return { toCreate, toReplace, toUpdate, toDelete, noop }
}
