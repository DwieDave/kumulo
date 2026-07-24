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

const _toBucketSpec = (bucket: ClusterConfig["object_storage"]["buckets"][number]): BucketSpec => ({
  name: bucket.name,
  region: bucket.region,
  versioning: bucket.versioning,
  encryption: bucket.encryption,
  retain: bucket.retain
})

const _desiredBuckets = (config: ClusterConfig): ReadonlyArray<BucketSpec> =>
  config.object_storage.buckets.map(_toBucketSpec)

const _bucketDiff = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<BucketDiff, OutputsInvalid | PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const file = yield* readOutputs({ dir: configDir, tag: config.name })
    return diffBuckets({ desired: _desiredBuckets(config), existing: file.buckets })
  })

/**
 * Plan actions for `object_storage.buckets` (R5) — diffed against the
 * last-recorded outputs file, never a live OVH call: OVH has no concept of
 * `retain` and doesn't expose `encryption` on its list endpoint, so kumulo's
 * own record is the only source that can answer "does this still need to
 * exist" for a bucket dropped from config (see `@kumulo/storage-ovh`'s
 * `outputs.ts`).
 */
export const bucketPlanActions = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<ReadonlyArray<PlanAction>, OutputsInvalid | PlatformError, FileSystem> =>
  config.object_storage.module !== "ovh"
    ? Effect.succeed([])
    : Effect.map(_bucketDiff({ config, configDir }), (diff) => [
      ...diff.toCreate.map((b) => ({ _tag: "Create" as const, name: `bucket/${b.name}` })),
      ...diff.toUpdate.map((u) => ({ _tag: "Create" as const, name: `bucket/${u.spec.name}` })),
      ...diff.toReplace.map((r) => ({
        _tag: "ReplaceNeedsConfirm" as const,
        name: `bucket/${r.spec.name}`,
        reason: "region or encryption changed (immutable, delete+recreate)"
      })),
      ...diff.toDelete.map((ref) => ({ _tag: "Delete" as const, name: `bucket/${ref.name}` })),
      ...diff.noop.map((ref) => ({ _tag: "NoOp" as const, name: `bucket/${ref.name}` }))
    ])

/** Applies one bucket diff via the provider — replace is delete-then-recreate (region/encryption are immutable on OVH's side). */
const _applyBucketDiff = (
  { provider, diff }: { readonly provider: StorageProvider; readonly diff: BucketDiff }
): Effect.Effect<void, ObjectStorageError> =>
  Effect.gen(function*() {
    yield* Effect.forEach(diff.toCreate, provider.ensureBucket, { discard: true })
    yield* Effect.forEach(diff.toUpdate, (u) => provider.ensureBucket(u.spec), { discard: true })
    yield* Effect.forEach(
      diff.toReplace,
      (r) => Effect.andThen(provider.deleteBucket(r.ref), provider.ensureBucket(r.spec)),
      { discard: true }
    )
    yield* Effect.forEach(diff.toDelete, provider.deleteBucket, { discard: true })
  })

const _bucketInfosFor = (
  { provider, desired }: { readonly provider: StorageProvider; readonly desired: ReadonlyArray<BucketSpec> }
): Effect.Effect<ReadonlyArray<BucketInfo>, ObjectStorageError> =>
  Effect.gen(function*() {
    const regions = [...new Set(desired.map((bucket) => bucket.region))]
    const lists = yield* Effect.forEach(regions, provider.listBuckets)
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
    const fs = yield* FileSystem
    const path = credentialsPath({ dir: config.secrets.dir, cluster: config.name })
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
    const file = yield* readOutputs({ dir: configDir, tag: config.name })
    const desired = _desiredBuckets(config)
    const diff = diffBuckets({ desired, existing: file.buckets })

    yield* _applyBucketDiff({ provider, diff })

    const desiredNames = new Set(desired.map((bucket) => bucket.name))
    const retainedOrphans = file.buckets.filter((bucket) => !desiredNames.has(bucket.name) && bucket.retain)
    yield* writeOutputs({ dir: configDir, file: { cluster: config.name, buckets: [...desired.map(toOutputsBucket), ...retainedOrphans] } })

    yield* _ensureCredentialsIfMissing({ config, provider, desired })
  })

/**
 * `delete` (R11): removes every non-retained recorded bucket (R6 refuses a
 * non-empty one, surfaced as-is — nothing else here is rolled back). Retained
 * buckets stay recorded in the outputs file so a future rebuild still sees
 * them. No-op when `object_storage.module` isn't `ovh`.
 */
export const reconcileBucketsOnDelete = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<ReadonlyArray<string>, ObjectStorageError | OutputsInvalid | PlatformError, ObjectStorageProvider | FileSystem> =>
  Effect.gen(function*() {
    if (config.object_storage.module !== "ovh") return []
    const provider = yield* ObjectStorageProvider
    const file = yield* readOutputs({ dir: configDir, tag: config.name })
    if (file.buckets.length === 0) return []

    const diff = diffBuckets({ desired: [], existing: file.buckets })
    yield* Effect.forEach(diff.toDelete, provider.deleteBucket, { discard: true })

    const retained = file.buckets.filter((bucket) => bucket.retain)
    yield* writeOutputs({ dir: configDir, file: { cluster: config.name, buckets: retained } })
    return retained.map((bucket) => bucket.name)
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
    const file = yield* readOutputs({ dir: configDir, tag: config.name })
    const credentialsExist = yield* fs.exists(credentialsPath({ dir: config.secrets.dir, cluster: config.name }))
    return { buckets: file.buckets, credentialsExist }
  })
