import { PlanAction } from "@kumulo/core"
import { Data, Effect, Predicate, Redacted, Schedule, Schema, Stream } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcess, ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/process"
import { ConfigInvalid, CredentialsSink, pollUntil, ProviderApiError, SinkUnavailable } from "@kumulo/core"
import type { BucketInfo, CredentialsSinkError, ObjectStorageError, S3Credentials } from "@kumulo/core"
import { credentialsPath, sopsCredentialsSinkLive } from "@kumulo/secrets-sops"
import { mapUpcloudError } from "@kumulo/upcloud"
import type { ObjectStorageClient } from "@kumulo/upcloud"
import { deleteBucket, ensureBucket, ensureCredentials, ensureService, ensureUserAccess, listBuckets, objectStorageUsername } from "@kumulo/storage-upcloud"
import type { UpcloudObjectStorageOptions } from "@kumulo/storage-upcloud"
import type { UpcloudUksClusterConfig } from "../cluster-config.ts"
import { credentialEntries } from "../storage/credentials.ts"
import { UpcloudEnv } from "./env.ts"

export const uksBucketRow = (name: string): string => `bucket/${name}`
export const uksObjectStorageRow = (cluster: string): string => `object-storage/${cluster}`

type ConfiguredBucket = Extract<UpcloudUksClusterConfig["object_storage"], { readonly module: "upcloud" }>["buckets"][number]

export const configuredUpcloudBuckets = (config: UpcloudUksClusterConfig): ReadonlyArray<ConfiguredBucket> =>
  config.object_storage.module === "upcloud" ? config.object_storage.buckets : []

const _options = (config: UpcloudUksClusterConfig): Omit<UpcloudObjectStorageOptions, "client"> =>
  config.object_storage.module !== "upcloud"
    ? { cluster: config.name, region: "" }
    : { cluster: config.name, region: config.object_storage.region }

export const bucketPlanActions = (
  { config, live }: { readonly config: UpcloudUksClusterConfig; readonly live: ReadonlyArray<BucketInfo> }
): ReadonlyArray<PlanAction> => {
  const liveNames = new Set(live.map((b) => b.name))

  return configuredUpcloudBuckets(config).map((bucket) => {
    const name = uksBucketRow(bucket.name)

    return liveNames.has(bucket.name) ? PlanAction.NoOp({ name }) : PlanAction.Create({ name })
  })
}

export const lookupUpcloudBuckets = (
  config: UpcloudUksClusterConfig
): Effect.Effect<ReadonlyArray<BucketInfo>, ObjectStorageError, UpcloudEnv> =>
  Effect.gen(function*() {
    if (config.object_storage.module !== "upcloud") return []
    const { objectStorage } = yield* UpcloudEnv
    const options = { client: objectStorage, ..._options(config) }

    return yield* listBuckets(options)(config.object_storage.region)
  })

const _sopsConfig = (
  config: UpcloudUksClusterConfig
): Effect.Effect<{ readonly dir: string; readonly ageRecipient: string }, ConfigInvalid> =>
  config.secrets.sink !== "sops"
    ? Effect.fail(
      new ConfigInvalid({
        issues: [{ path: ["secrets", "sops"], message: "sops config is required when object_storage.module is upcloud" }]
      })
    )
    : Effect.succeed({ dir: config.secrets.dir, ageRecipient: config.secrets.sops.age_recipient })

const _StoredS3 = Schema.Struct({
  s3: Schema.Struct({ user: Schema.String, accessKey: Schema.String, secretKey: Schema.String })
})

// kumulo: the sink can only write whole files, so a re-run decrypts the file to keep the existing secret.
const _readStoredCredentials = (
  { path, spawner }: { readonly path: string; readonly spawner: (typeof ChildProcessSpawnerNS.ChildProcessSpawner)["Service"] }
): Effect.Effect<S3Credentials, SinkUnavailable> =>
  Effect.scoped(Effect.gen(function*() {
    const handle = yield* spawner.spawn(ChildProcess.make("sops", ["--decrypt", "--output-type", "json", path]))

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr)), handle.exitCode],
      { concurrency: "unbounded" }
    )

    if (exitCode !== 0) {
      return yield* Effect.fail(new SinkUnavailable({ hint: `sops exited with code ${exitCode} reading ${path}: ${stderr.trim()}` }))
    }

    const stored = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(_StoredS3))(stdout).pipe(
      Effect.mapError((cause) => new SinkUnavailable({ hint: `${path} has no s3 user and keys: ${cause.message}` }))
    )

    return {
      user: stored.s3.user,
      accessKey: Redacted.make(stored.s3.accessKey),
      secretKey: Redacted.make(stored.s3.secretKey),
      buckets: []
    }
  })).pipe(Effect.catchTag("PlatformError", (cause) => Effect.fail(new SinkUnavailable({ hint: cause.message }))))

export const convergeUpcloudBuckets = (
  config: UpcloudUksClusterConfig
): Effect.Effect<
  void,
  ObjectStorageError | ConfigInvalid | CredentialsSinkError | PlatformError,
  UpcloudEnv | FileSystem | ChildProcessSpawnerNS.ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const buckets = configuredUpcloudBuckets(config)

    if (buckets.length === 0) return
    const { objectStorage } = yield* UpcloudEnv
    const options = { client: objectStorage, ..._options(config) }

    const service = yield* ensureService(options)

    const ensured = yield* Effect.forEach(buckets, (bucket) =>
      ensureBucket(options)({ name: bucket.name, region: options.region, versioning: false, encryption: false, retain: bucket.retain }, service), {
      concurrency: 4
    })

    yield* ensureUserAccess(options)(config.name)

    const sops = yield* _sopsConfig(config)
    const fs = yield* FileSystem
    const path = credentialsPath({ dir: sops.dir, cluster: config.name })
    const spawner = yield* ChildProcessSpawnerNS.ChildProcessSpawner
    const creds = (yield* fs.exists(path)) ? yield* _readStoredCredentials({ path, spawner }) : yield* ensureCredentials(options)(config.name)
    const sink = sopsCredentialsSinkLive({ dir: sops.dir, ageRecipient: sops.ageRecipient, spawner, fs })
    yield* Effect.flatMap(CredentialsSink, (s) => s.write(credentialEntries({ cluster: config.name, creds, buckets: ensured, withRegion: false }))).pipe(
      Effect.provide(sink)
    )
  })

export class UnmanagedBucketsPresent extends Data.TaggedError("UnmanagedBucketsPresent")<{
  readonly service: string
  readonly buckets: ReadonlyArray<string>
}> {}

// Deletes the service only when every bucket in it is configured and retain:false; never forces.
export const reconcileUpcloudObjectStorageOnDelete = (
  config: UpcloudUksClusterConfig
): Effect.Effect<
  { readonly kept: ReadonlyArray<string>; readonly deleted: ReadonlyArray<string> },
  ObjectStorageError | UnmanagedBucketsPresent,
  UpcloudEnv
> =>
  Effect.gen(function*() {
    const buckets = configuredUpcloudBuckets(config)

    if (buckets.length === 0) return { kept: [], deleted: [] }
    const { objectStorage } = yield* UpcloudEnv
    const options = { client: objectStorage, ..._options(config) }
    const toDelete = buckets.filter((b) => !b.retain)
    yield* Effect.forEach(toDelete, (b) => deleteBucket(options)({ name: b.name, region: options.region }), {
      discard: true,
      concurrency: 4
    })

    const services = yield* mapUpcloudError({
      self: objectStorage.services.list(),
      ctx: { kind: "object-storage-service", ref: config.name }
    })

    const service = services.find((s) => s.name === `${config.name}-objsto`)

    if (service !== undefined) {
      const live = yield* mapUpcloudError({
        self: objectStorage.buckets.list(service.uuid),
        ctx: { kind: "object-storage-service", ref: service.uuid }
      })

      const configured = new Set(buckets.map((b) => b.name))
      const unmanaged = live.filter((b) => b.deleted !== true && !configured.has(b.name)).map((b) => b.name)

      if (unmanaged.length > 0) return yield* Effect.fail(new UnmanagedBucketsPresent({ service: service.uuid, buckets: unmanaged }))

      if (buckets.every((b) => !b.retain)) {
        yield* _deleteServiceWithoutForce({ objectStorage, uuid: service.uuid, username: objectStorageUsername(config.name) })
        // Network delete 409s until service deletion (async) finishes, so poll before continuing (live probe 2026-08-01).
        yield* _awaitServiceGone({ objectStorage, uuid: service.uuid })
      }
    }

    return { kept: buckets.filter((b) => b.retain).map((b) => b.name), deleted: toDelete.map((b) => b.name) }
  })

// Bucket cleanup is asynchronous (cleanup-deleted-buckets), so a non-force delete 409s until it finishes.
const _deleteServiceWithoutForce = (
  { objectStorage, uuid, username }: { readonly objectStorage: ObjectStorageClient; readonly uuid: string; readonly username: string }
): Effect.Effect<void, ObjectStorageError> =>
  Effect.gen(function*() {
    yield* mapUpcloudError({
      self: objectStorage.users.delete(uuid, username),
      ctx: { kind: "object-storage-user", ref: username }
    }).pipe(Effect.catchTag("ResourceNotFound", () => Effect.void))

    yield* mapUpcloudError({
      self: objectStorage.services.delete(uuid),
      ctx: { kind: "object-storage-service", ref: uuid }
    }).pipe(
      Effect.retry({
        while: Predicate.isTagged("ResourceConflict"),
        schedule: Schedule.spaced("10 seconds"),
        times: 60
      })
    )
  })

const _awaitServiceGone = (
  { objectStorage, uuid }: { readonly objectStorage: ObjectStorageClient; readonly uuid: string }
): Effect.Effect<void, ObjectStorageError> =>
  pollUntil({
    check: mapUpcloudError({ self: objectStorage.services.get(uuid), ctx: { kind: "object-storage-service", ref: uuid } }).pipe(
      Effect.map(() => "deleting"),
      Effect.catchTag("ResourceNotFound", () => Effect.succeed("gone"))
    ),
    isDone: (state) => state === "gone",
    interval: "3 seconds",
    timeout: "10 minutes",
    kind: "object-storage-service",
    ref: uuid
  }).pipe(
    Effect.asVoid,
    Effect.catchTag("ProvisioningTimeout", (e) =>
      Effect.fail(new ProviderApiError({ operation: `object-storage-service ${uuid} teardown`, status: 0, body: `still ${e.lastStatus} after 10 minutes` })))
  )
