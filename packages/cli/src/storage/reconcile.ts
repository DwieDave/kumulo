import { Effect, Redacted } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import type { BucketInfo, BucketSpec, ClusterConfig, CredentialEntry, ObjectStorageError, PlanAction, S3Credentials } from "@kumulo/core"
import { CredentialsSink, ObjectStorageProvider } from "@kumulo/core"
import type { CredentialsSinkError } from "@kumulo/core"
import { diffBuckets, readOutputs, toOutputsBucket, writeOutputs } from "@kumulo/storage-ovh"
import type { BucketDiff, OutputsInvalid } from "@kumulo/storage-ovh"
import { credentialsPath } from "@kumulo/secrets-sops"

export type BucketReconcileError = ObjectStorageError | CredentialsSinkError | OutputsInvalid | PlatformError

type StorageProvider = ObjectStorageProvider["Service"]

/** One configured bucket — only the `module: ovh` variant of the union carries them. */
type ConfiguredBucket = Exclude<ClusterConfig["object_storage"], { readonly module: "none" }>["buckets"][number]

/**
 * `secrets.dir` behind the union discriminant. `undefined` means `sink: none`,
 * which the schema only allows when `object_storage.module` isn't `ovh`
 * (`isSecretsRequiredForObjectStorage`) — so there is nothing to write there.
 */
const _sopsDir = (config: ClusterConfig): string | undefined =>
  config.secrets.sink === "sops" ? config.secrets.dir : undefined

const _toBucketSpec = (bucket: ConfiguredBucket): BucketSpec => ({
  name: bucket.name,
  region: bucket.region,
  versioning: bucket.versioning,
  encryption: bucket.encryption,
  retain: bucket.retain
})

const _desiredBuckets = (config: ClusterConfig): ReadonlyArray<BucketSpec> =>
  config.object_storage.module === "none" ? [] : config.object_storage.buckets.map(_toBucketSpec)

const _bucketDiff = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<BucketDiff, OutputsInvalid | PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const file = yield* readOutputs({ dir: configDir, tag: config.name, format: config.outputs?.format })
    return diffBuckets({ desired: _desiredBuckets(config), existing: file.buckets })
  })

/**
 * Plan actions for `object_storage.buckets` (R5). The retain/encryption diff
 * comes from the last-recorded outputs file (OVH can't answer those), but
 * existence is verified live: a bucket the record calls converged that no
 * longer exists on OVH plans as Create, not NoOp.
 */
export const bucketPlanActions = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<ReadonlyArray<PlanAction>, ObjectStorageError | OutputsInvalid | PlatformError, ObjectStorageProvider | FileSystem> =>
  config.object_storage.module !== "ovh"
    ? Effect.succeed([])
    : Effect.gen(function*() {
      const diff = yield* _bucketDiff({ config, configDir })
      const provider = yield* ObjectStorageProvider
      const regions = [...new Set(diff.noop.map((ref) => ref.region))]
      const live = yield* Effect.forEach(regions, provider.listBuckets, { concurrency: 4 })
      const liveNames = new Set(live.flat().map((bucket) => bucket.name))
      return [
        ...diff.toCreate.map((b) => ({ _tag: "Create" as const, name: `bucket/${b.name}` })),
        ...diff.toUpdate.map((u) => ({ _tag: "Update" as const, name: `bucket/${u.spec.name}`, reason: "versioning" })),
        ...diff.toReplace.map((r) => ({
          _tag: "ReplaceNeedsConfirm" as const,
          name: `bucket/${r.spec.name}`,
          reason: "region or encryption changed (immutable, delete+recreate)"
        })),
        ...diff.toDelete.map((ref) => ({ _tag: "Delete" as const, name: `bucket/${ref.name}` })),
        ...diff.noop.map((ref) =>
          liveNames.has(ref.name)
            ? { _tag: "NoOp" as const, name: `bucket/${ref.name}` }
            : { _tag: "Create" as const, name: `bucket/${ref.name}` }
        )
      ]
    })

/** Applies one bucket diff via the provider — replace is delete-then-recreate (region/encryption are immutable on OVH's side). */
const _applyBucketDiff = (
  { provider, diff, desired }: { readonly provider: StorageProvider; readonly diff: BucketDiff; readonly desired: ReadonlyArray<BucketSpec> }
): Effect.Effect<void, ObjectStorageError> =>
  Effect.gen(function*() {
    // Buckets are independent of each other — each diff class converges
    // concurrently (bounded: OVH rate limits).
    yield* Effect.forEach(diff.toCreate, provider.ensureBucket, { discard: true, concurrency: 4 })
    // Heal out-of-band deletions: a bucket the outputs file says is converged
    // may have been removed behind kumulo's back — `ensureBucket` checks live
    // state and only creates when actually missing, so re-ensuring noops is
    // both cheap and safe.
    const byName = new Map(desired.map((spec) => [spec.name, spec]))
    const noopSpecs = diff.noop.flatMap((ref) => byName.get(ref.name) ?? [])
    yield* Effect.forEach(noopSpecs, provider.ensureBucket, { discard: true, concurrency: 4 })
    yield* Effect.forEach(diff.toUpdate, (u) => provider.ensureBucket(u.spec), { discard: true, concurrency: 4 })
    yield* Effect.forEach(
      diff.toReplace,
      (r) => Effect.andThen(provider.deleteBucket(r.ref), provider.ensureBucket(r.spec)),
      { discard: true, concurrency: 4 }
    )
    yield* Effect.forEach(diff.toDelete, provider.deleteBucket, { discard: true, concurrency: 4 })
  })

const _bucketInfosFor = (
  { provider, desired }: { readonly provider: StorageProvider; readonly desired: ReadonlyArray<BucketSpec> }
): Effect.Effect<ReadonlyArray<BucketInfo>, ObjectStorageError> =>
  Effect.gen(function*() {
    const regions = [...new Set(desired.map((bucket) => bucket.region))]
    const lists = yield* Effect.forEach(regions, provider.listBuckets, { concurrency: 4 })
    const names = new Set(desired.map((bucket) => bucket.name))
    return lists.flat().filter((bucket) => names.has(bucket.name))
  })

const _credentialEntries = (
  { config, creds, buckets }: { readonly config: ClusterConfig; readonly creds: S3Credentials; readonly buckets: ReadonlyArray<BucketInfo> }
): ReadonlyArray<CredentialEntry> => [
  { key: "cluster", value: Redacted.make(config.name) },
  { key: "s3.user", value: Redacted.make(creds.user) },
  { key: "s3.accessKey", value: creds.accessKey },
  { key: "s3.secretKey", value: creds.secretKey },
  ...buckets.flatMap((bucket, index) => [
    { key: `s3.buckets.${index}.name`, value: Redacted.make(bucket.name) },
    { key: `s3.buckets.${index}.region`, value: Redacted.make(bucket.region) },
    { key: `s3.buckets.${index}.endpoint`, value: Redacted.make(bucket.endpoint) }
  ])
]

/**
 * R7: OVH only ever returns an S3 secret once (on creation) — a credential
 * that already exists can't be re-read, so a credentials file already on
 * disk means a prior run already wrote the real secret. Skip `ensureCredentials`
 * (and the whole write) entirely rather than fabricate/omit one.
 */
const _ensureCredentialsIfMissing = (
  { config, provider, desired }: { readonly config: ClusterConfig; readonly provider: StorageProvider; readonly desired: ReadonlyArray<BucketSpec> }
): Effect.Effect<void, BucketReconcileError, CredentialsSink | FileSystem> =>
  Effect.gen(function*() {
    const dir = _sopsDir(config)
    if (dir === undefined) return
    const fs = yield* FileSystem
    const path = credentialsPath({ dir, cluster: config.name })
    if (yield* fs.exists(path)) return
    const creds = yield* provider.ensureCredentials(config.name)
    const buckets = yield* _bucketInfosFor({ provider, desired })
    const sink = yield* CredentialsSink
    yield* sink.write(_credentialEntries({ config, creds, buckets }))
  })

/**
 * Converges `object_storage.buckets` (create/scale, R11): applies the diff
 * against the last-recorded outputs, records the new state, then issues
 * credentials last (R7) — only if none are recorded yet for this cluster.
 * No-op when `object_storage.module` isn't `ovh`.
 */
export const convergeBuckets = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<void, BucketReconcileError, ObjectStorageProvider | CredentialsSink | FileSystem> =>
  Effect.gen(function*() {
    if (config.object_storage.module !== "ovh") return
    const provider = yield* ObjectStorageProvider
    const file = yield* readOutputs({ dir: configDir, tag: config.name, format: config.outputs?.format })
    const desired = _desiredBuckets(config)
    const diff = diffBuckets({ desired, existing: file.buckets })

    yield* _applyBucketDiff({ provider, diff, desired })

    const desiredNames = new Set(desired.map((bucket) => bucket.name))
    const retainedOrphans = file.buckets.filter((bucket) => !desiredNames.has(bucket.name) && bucket.retain)
    yield* writeOutputs({
      dir: configDir,
      file: { cluster: config.name, buckets: [...desired.map(toOutputsBucket), ...retainedOrphans] },
      format: config.outputs?.format
    })

    yield* _ensureCredentialsIfMissing({ config, provider, desired })
  })

/**
 * Delete-plan rows from the recorded outputs: non-retained buckets as
 * Delete, retained ones as NoOp tagged "(retained)" so the plan shows why
 * they survive.
 */
export const bucketDeletePlanActions = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<ReadonlyArray<PlanAction>, OutputsInvalid | PlatformError, FileSystem> =>
  Effect.gen(function*() {
    if (config.object_storage.module !== "ovh") return []
    const file = yield* readOutputs({ dir: configDir, tag: config.name, format: config.outputs?.format })
    const diff = diffBuckets({ desired: [], existing: file.buckets })
    return [
      ...diff.toDelete.map((ref) => ({ _tag: "Delete" as const, name: `bucket/${ref.name}` })),
      ...file.buckets.filter((bucket) => bucket.retain).map((bucket) => ({
        _tag: "NoOp" as const,
        name: `bucket/${bucket.name} (retained)`
      }))
    ]
  })

/**
 * `delete` (R11): removes every non-retained recorded bucket (R6 refuses a
 * non-empty one, surfaced as-is — nothing else here is rolled back). Retained
 * buckets stay recorded in the outputs file so a future rebuild still sees
 * them. No-op when `object_storage.module` isn't `ovh`.
 */
export const reconcileBucketsOnDelete = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<
  { readonly kept: ReadonlyArray<string>; readonly deleted: ReadonlyArray<string> },
  ObjectStorageError | OutputsInvalid | PlatformError,
  ObjectStorageProvider | FileSystem
> =>
  Effect.gen(function*() {
    if (config.object_storage.module !== "ovh") return { kept: [], deleted: [] }
    const provider = yield* ObjectStorageProvider
    const file = yield* readOutputs({ dir: configDir, tag: config.name, format: config.outputs?.format })
    if (file.buckets.length === 0) return { kept: [], deleted: [] }

    const diff = diffBuckets({ desired: [], existing: file.buckets })
    yield* Effect.forEach(diff.toDelete, provider.deleteBucket, { discard: true, concurrency: 4 })

    const retained = file.buckets.filter((bucket) => bucket.retain)
    yield* writeOutputs({ dir: configDir, file: { cluster: config.name, buckets: retained }, format: config.outputs?.format })
    return { kept: retained.map((bucket) => bucket.name), deleted: diff.toDelete.map((ref) => ref.name) }
  })

/** `status` (R11): buckets recorded for this cluster + whether its credentials file exists — no OVH call. */
export const bucketStatus = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<
  { readonly buckets: ReadonlyArray<{ readonly name: string; readonly region: string; readonly retain: boolean }>; readonly credentialsExist: boolean },
  OutputsInvalid | PlatformError,
  FileSystem
> =>
  Effect.gen(function*() {
    if (config.object_storage.module !== "ovh") return { buckets: [], credentialsExist: false }
    const fs = yield* FileSystem
    const file = yield* readOutputs({ dir: configDir, tag: config.name, format: config.outputs?.format })
    const dir = _sopsDir(config)
    const credentialsExist = dir === undefined
      ? false
      : yield* fs.exists(credentialsPath({ dir, cluster: config.name }))
    return { buckets: file.buckets, credentialsExist }
  })
