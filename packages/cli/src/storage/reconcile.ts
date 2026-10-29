import { ConfigInvalid, PlanAction } from "@kumulo/core"
import { Effect, Option } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import type { BucketInfo, BucketRef, BucketSpec, ObjectStorageError } from "@kumulo/core"
import type { ClusterConfig } from "../cluster-config.ts"
import { CredentialsSink, ObjectStorageProvider } from "@kumulo/core"
import type { CredentialsSinkError } from "@kumulo/core"
import { diffBuckets, readOutputs, toOutputsBucket, writeOutputs } from "@kumulo/storage-ovh"
import type { BucketDiff, OutputsInvalid } from "@kumulo/storage-ovh"
import {
  diffBuckets as bunnyDiffBuckets,
  makeBunnyObjectStorageProvider,
  readOutputs as bunnyReadOutputs,
  writeOutputs as bunnyWriteOutputs
} from "@kumulo/storage-bunny"
import type { BunnyTier, OutputsBucket as BunnyOutputsBucket, OutputsInvalid as BunnyOutputsInvalid } from "@kumulo/storage-bunny"
import { credentialsPath } from "@kumulo/secrets-sops"
import { credentialEntries } from "./credentials.ts"
import { BunnyStorage } from "./env.ts"

export type BucketReconcileError =
  | ObjectStorageError
  | CredentialsSinkError
  | OutputsInvalid
  | BunnyOutputsInvalid
  | ConfigInvalid
  | PlatformError

type StorageProvider = ObjectStorageProvider["Service"]

interface DesiredBucket extends BucketSpec {
  readonly tier?: BunnyTier | undefined
}

interface GenericDiff {
  readonly toCreate: ReadonlyArray<BucketSpec>
  readonly toUpdate: ReadonlyArray<{ readonly spec: BucketSpec }>
  readonly toReplace: ReadonlyArray<{ readonly ref: BucketRef; readonly spec: BucketSpec }>
  readonly toDelete: ReadonlyArray<BucketRef>
  readonly noop: ReadonlyArray<BucketRef>
}

interface RecordedBucket {
  readonly name: string
  readonly region: string
  readonly retain: boolean
}

interface Loaded {
  readonly desired: ReadonlyArray<DesiredBucket>
  readonly diff: GenericDiff
  readonly recorded: ReadonlyArray<RecordedBucket>
}

type LoadError = OutputsInvalid | BunnyOutputsInvalid | PlatformError

const _sopsDir = (config: ClusterConfig): string | undefined =>
  config.secrets.sink === "sops" ? config.secrets.dir : undefined

const _desiredBuckets = (config: ClusterConfig): ReadonlyArray<DesiredBucket> => {
  const storage = config.object_storage

  if (storage.module === "ovh") {
    return storage.buckets.map((bucket) => ({
      name: bucket.name,
      region: bucket.region,
      versioning: bucket.versioning,
      encryption: bucket.encryption,
      retain: bucket.retain
    }))
  }

  if (storage.module === "bunny") {
    return storage.buckets.map((bucket): DesiredBucket => ({
      name: bucket.name,
      region: bucket.region,
      versioning: false,
      encryption: false,
      retain: bucket.retain,
      tier: bucket.tier
    }))
  }

  return []
}

const _isStorageModule = (config: ClusterConfig): boolean =>
  config.object_storage.module === "ovh" || config.object_storage.module === "bunny"

const _loadBunny = (
  { config, configDir, desired }: { readonly config: ClusterConfig; readonly configDir: string; readonly desired: ReadonlyArray<DesiredBucket> }
): Effect.Effect<Loaded, LoadError, FileSystem> =>
  Effect.map(bunnyReadOutputs({ dir: configDir, tag: config.name, format: config.outputs?.format }), (file) => {
    const diff = bunnyDiffBuckets({ desired, existing: file.buckets })
    const byName = new Map(desired.map((spec) => [spec.name, spec]))

    return {
      desired,
      recorded: file.buckets,
      diff: {
        toCreate: diff.toCreate.flatMap((spec) => byName.get(spec.name) ?? []),
        toUpdate: [],
        toReplace: diff.toReplace.flatMap((r) => {
          const spec = byName.get(r.spec.name)

          return spec === undefined ? [] : [{ ref: r.ref, spec }]
        }),
        toDelete: diff.toDelete,
        noop: diff.noop
      }
    }
  })

const _load = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<Loaded, LoadError, FileSystem> =>
  config.object_storage.module === "bunny"
    ? _loadBunny({ config, configDir, desired: _desiredBuckets(config) })
    : Effect.map(readOutputs({ dir: configDir, tag: config.name, format: config.outputs?.format }), (file) => {
      const desired = _desiredBuckets(config)

      return { desired, recorded: file.buckets, diff: diffBuckets({ desired, existing: file.buckets }) }
    })

export const bucketPlanActions = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<ReadonlyArray<PlanAction>, ObjectStorageError | LoadError, ObjectStorageProvider | FileSystem> =>
  !_isStorageModule(config)
    ? Effect.succeed([])
    : Effect.gen(function*() {
      const { diff } = yield* _load({ config, configDir })
      const provider = yield* ObjectStorageProvider
      const regions = [...new Set(diff.noop.map((ref) => ref.region))]
      const live = yield* Effect.forEach(regions, provider.listBuckets, { concurrency: 4 })
      const liveNames = new Set(live.flat().map((bucket) => bucket.name))

      return [
        ...diff.toCreate.map((b) => (PlanAction.Create({ name: `bucket/${b.name}` }))),
        ...diff.toUpdate.map((u) => (PlanAction.Update({ name: `bucket/${u.spec.name}`, reason: "versioning" }))),
        ...diff.toReplace.map((r) => (PlanAction.ReplaceNeedsConfirm({ name: `bucket/${r.spec.name}`,
          reason: "region or encryption changed (immutable, delete+recreate)" }))),
        ...diff.toDelete.map((ref) => (PlanAction.Delete({ name: `bucket/${ref.name}` }))),
        ...diff.noop.map((ref) =>
          liveNames.has(ref.name)
            ? PlanAction.NoOp({ name: `bucket/${ref.name}` })
            : PlanAction.Create({ name: `bucket/${ref.name}` })
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
    yield* sink.write(credentialEntries({ cluster: config.name, creds, buckets, withRegion: true }))
  })

const _convergeOvh = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<void, BucketReconcileError, ObjectStorageProvider | CredentialsSink | FileSystem> =>
  Effect.gen(function*() {
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

const _bunnyOwnedFor = (
  { owned, remove }: { readonly owned: ReadonlyArray<BunnyOutputsBucket>; readonly remove: ReadonlySet<string> }
): ReadonlyArray<BunnyOutputsBucket> => owned.filter((bucket) => !remove.has(bucket.name))

const _convergeBunny = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<void, BucketReconcileError, CredentialsSink | FileSystem> =>
  Effect.gen(function*() {
    const access = yield* Effect.serviceOption(BunnyStorage)

    if (Option.isNone(access)) {
      return yield* Effect.fail(
        new ConfigInvalid({ issues: [{ path: ["object_storage"], message: "bunny storage client is unavailable" }] })
      )
    }

    const { storage } = access.value
    const format = config.outputs?.format
    const file = yield* bunnyReadOutputs({ dir: configDir, tag: config.name, format })
    const desired = _desiredBuckets(config)
    const { diff } = yield* _loadBunny({ config, configDir, desired })

    const removed = new Set([...diff.toReplace.map((r) => r.ref.name), ...diff.toDelete.map((ref) => ref.name)])

    const deleter = makeBunnyObjectStorageProvider({ storage, owned: file.buckets })
    const doomed = [...diff.toReplace.map((r) => r.ref), ...diff.toDelete]

    const [deletedNames, deleteFailures] = yield* Effect.partition(
      doomed,
      (ref) => Effect.as(deleter.deleteBucket(ref), ref.name),
      { concurrency: 4 }
    )

    const ensurer = makeBunnyObjectStorageProvider({ storage, owned: _bunnyOwnedFor({ owned: file.buckets, remove: removed }) })
    const [ensured, ensureFailures] = yield* Effect.partition(desired, ensurer.ensureZone, { concurrency: 4 })
    const settled = new Set([...deletedNames, ...ensured.map((zone) => zone.bucket.name)])
    const kept = file.buckets.filter((bucket) => !settled.has(bucket.name))
    const buckets = [...ensured.map((zone) => zone.bucket), ...kept]
    const firstFailure = [...deleteFailures, ...ensureFailures][0]
    yield* bunnyWriteOutputs({ dir: configDir, file: { cluster: config.name, buckets }, format })

    if (firstFailure !== undefined) return yield* Effect.fail(firstFailure)

    const dir = _sopsDir(config)

    if (dir === undefined) return
    const fs = yield* FileSystem
    const changed = diff.toCreate.length > 0 || removed.size > 0

    if (!changed && (yield* fs.exists(credentialsPath({ dir, cluster: config.name })))) return
    const creds = yield* makeBunnyObjectStorageProvider({ storage, owned: buckets }).ensureCredentials(config.name)
    const sink = yield* CredentialsSink
    yield* sink.write(credentialEntries({ cluster: config.name, creds, buckets: creds.buckets, withRegion: true }))
  })

export const convergeBuckets = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<void, BucketReconcileError, ObjectStorageProvider | CredentialsSink | FileSystem> => {
  if (config.object_storage.module === "bunny") return _convergeBunny({ config, configDir })

  return config.object_storage.module === "ovh" ? _convergeOvh({ config, configDir }) : Effect.void
}

const _configuredNames = (config: ClusterConfig): ReadonlyArray<string> =>
  config.object_storage.module === "ovh" || config.object_storage.module === "bunny"
    ? config.object_storage.buckets.map((bucket) => bucket.name)
    : []

export const bucketDeletePlanActions = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<ReadonlyArray<PlanAction>, LoadError, FileSystem> =>
  Effect.gen(function*() {
    if (!_isStorageModule(config)) return []
    const { recorded } = yield* _loadForDelete({ config, configDir })
    const recordedNames = new Set(recorded.map((bucket) => bucket.name))

    return [
      ...recorded.filter((bucket) => !bucket.retain).map((bucket) => (PlanAction.Delete({ name: `bucket/${bucket.name}` }))),
      ...recorded.filter((bucket) => bucket.retain).map((bucket) => (PlanAction.NoOp({ name: `bucket/${bucket.name} (retained)` }))),
      ..._configuredNames(config).filter((name) => !recordedNames.has(name)).map((name) => (PlanAction.NoOp({ name: `bucket/${name} (already absent)` })))
    ]
  })

const _loadForDelete = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<{ readonly recorded: ReadonlyArray<RecordedBucket> }, LoadError, FileSystem> =>
  config.object_storage.module === "bunny"
    ? Effect.map(bunnyReadOutputs({ dir: configDir, tag: config.name, format: config.outputs?.format }), (file) => ({ recorded: file.buckets }))
    : Effect.map(readOutputs({ dir: configDir, tag: config.name, format: config.outputs?.format }), (file) => ({ recorded: file.buckets }))

const _writeRetained = (
  { config, configDir, retained }: { readonly config: ClusterConfig; readonly configDir: string; readonly retained: ReadonlyArray<string> }
): Effect.Effect<void, LoadError, FileSystem> =>
  Effect.gen(function*() {
    const format = config.outputs?.format
    const keep = new Set(retained)

    if (config.object_storage.module === "bunny") {
      const file = yield* bunnyReadOutputs({ dir: configDir, tag: config.name, format })
      yield* bunnyWriteOutputs({ dir: configDir, file: { cluster: config.name, buckets: file.buckets.filter((b) => keep.has(b.name)) }, format })

      return
    }

    const file = yield* readOutputs({ dir: configDir, tag: config.name, format })
    yield* writeOutputs({ dir: configDir, file: { cluster: config.name, buckets: file.buckets.filter((b) => keep.has(b.name)) }, format })
  })

export const reconcileBucketsOnDelete = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<
  { readonly kept: ReadonlyArray<string>; readonly deleted: ReadonlyArray<string> },
  ObjectStorageError | LoadError,
  ObjectStorageProvider | FileSystem
> =>
  Effect.gen(function*() {
    if (!_isStorageModule(config)) return { kept: [], deleted: [] }
    const provider = yield* ObjectStorageProvider
    const { recorded } = yield* _loadForDelete({ config, configDir })

    if (recorded.length === 0) return { kept: [], deleted: [] }

    const toDelete = recorded.filter((bucket) => !bucket.retain)
    yield* Effect.forEach(toDelete, (bucket) => provider.deleteBucket({ name: bucket.name, region: bucket.region }), {
      discard: true,
      concurrency: 4
    })

    const retained = recorded.filter((bucket) => bucket.retain).map((bucket) => bucket.name)
    yield* _writeRetained({ config, configDir, retained })

    return { kept: retained, deleted: toDelete.map((bucket) => bucket.name) }
  })

export const bucketStatus = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<
  { readonly buckets: ReadonlyArray<{ readonly name: string; readonly region: string; readonly retain: boolean }>; readonly credentialsExist: boolean },
  LoadError,
  FileSystem
> =>
  Effect.gen(function*() {
    if (!_isStorageModule(config)) return { buckets: [], credentialsExist: false }
    const fs = yield* FileSystem
    const { recorded } = yield* _loadForDelete({ config, configDir })
    const dir = _sopsDir(config)

    const credentialsExist = dir === undefined
      ? false
      : yield* fs.exists(credentialsPath({ dir, cluster: config.name }))

    return { buckets: recorded, credentialsExist }
  })
