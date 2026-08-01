import { Effect, Redacted } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import type { BucketInfo, BucketSpec, CredentialEntry, ObjectStorageError, PlanAction, S3Credentials } from "@kumulo/core"
import type { ClusterConfig } from "../cluster-config.ts"
import { CredentialsSink, ObjectStorageProvider } from "@kumulo/core"
import type { CredentialsSinkError } from "@kumulo/core"
import { diffBuckets, readOutputs, toOutputsBucket, writeOutputs } from "@kumulo/storage-ovh"
import type { BucketDiff, OutputsInvalid } from "@kumulo/storage-ovh"
import { credentialsPath } from "@kumulo/secrets-sops"

export type BucketReconcileError = ObjectStorageError | CredentialsSinkError | OutputsInvalid | PlatformError

type StorageProvider = ObjectStorageProvider["Service"]

type ConfiguredBucket = Extract<ClusterConfig["object_storage"], { readonly module: "ovh" }>["buckets"][number]

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
  config.object_storage.module === "ovh" ? config.object_storage.buckets.map(_toBucketSpec) : []

const _bucketDiff = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<BucketDiff, OutputsInvalid | PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const file = yield* readOutputs({ dir: configDir, tag: config.name, format: config.outputs?.format })
    return diffBuckets({ desired: _desiredBuckets(config), existing: file.buckets })
  })

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

const _applyBucketDiff = (
  { provider, diff, desired }: { readonly provider: StorageProvider; readonly diff: BucketDiff; readonly desired: ReadonlyArray<BucketSpec> }
): Effect.Effect<void, ObjectStorageError> =>
  Effect.gen(function*() {
    yield* Effect.forEach(diff.toCreate, provider.ensureBucket, { discard: true, concurrency: 4 })
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

// kumulo: OVH returns the S3 secret only once (on creation) — if a credentials file already exists, skip re-issuing rather than fabricate/omit one.
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

export const bucketDeletePlanActions = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<ReadonlyArray<PlanAction>, OutputsInvalid | PlatformError, FileSystem> =>
  Effect.gen(function*() {
    if (config.object_storage.module !== "ovh") return []
    const file = yield* readOutputs({ dir: configDir, tag: config.name, format: config.outputs?.format })
    const diff = diffBuckets({ desired: [], existing: file.buckets })
    const recorded = new Set(file.buckets.map((bucket) => bucket.name))
    return [
      ...diff.toDelete.map((ref) => ({ _tag: "Delete" as const, name: `bucket/${ref.name}` })),
      ...file.buckets.filter((bucket) => bucket.retain).map((bucket) => ({
        _tag: "NoOp" as const,
        name: `bucket/${bucket.name} (retained)`
      })),
      ...config.object_storage.buckets.filter((bucket) => !recorded.has(bucket.name)).map((bucket) => ({
        _tag: "NoOp" as const,
        name: `bucket/${bucket.name} (already absent)`
      }))
    ]
  })

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
