import { Effect, Redacted } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"
import { ConfigInvalid, CredentialsSink, pollUntil, ProviderApiError } from "@kumulo/core"
import type { BucketInfo, CredentialEntry, CredentialsSinkError, ObjectStorageError, PlanAction, S3Credentials } from "@kumulo/core"
import { credentialsPath, sopsCredentialsSinkLive } from "@kumulo/secrets-sops"
import { mapUpcloudError } from "@kumulo/upcloud"
import type { ObjectStorageClient } from "@kumulo/upcloud"
import { deleteBucket, ensureBucket, ensureCredentials, listBuckets } from "@kumulo/storage-upcloud"
import type { UpcloudObjectStorageOptions } from "@kumulo/storage-upcloud"
import type { UpcloudUksClusterConfig } from "../cluster-config.ts"
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
    return liveNames.has(bucket.name) ? { _tag: "NoOp" as const, name } : { _tag: "Create" as const, name }
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

const _credentialEntries = (
  { config, creds, buckets }: { readonly config: UpcloudUksClusterConfig; readonly creds: S3Credentials; readonly buckets: ReadonlyArray<BucketInfo> }
): ReadonlyArray<CredentialEntry> => [
  { key: "cluster", value: Redacted.make(config.name) },
  { key: "s3.user", value: Redacted.make(creds.user) },
  { key: "s3.accessKey", value: creds.accessKey },
  { key: "s3.secretKey", value: creds.secretKey },
  ...buckets.flatMap((bucket, index) => [
    { key: `s3.buckets.${index}.name`, value: Redacted.make(bucket.name) },
    { key: `s3.buckets.${index}.endpoint`, value: Redacted.make(bucket.endpoint) }
  ])
]

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
    const ensured = yield* Effect.forEach(buckets, (bucket) =>
      ensureBucket(options)({ name: bucket.name, region: options.region, versioning: false, encryption: false, retain: bucket.retain }), {
      concurrency: 4
    })

    const sops = yield* _sopsConfig(config)
    const fs = yield* FileSystem
    const path = credentialsPath({ dir: sops.dir, cluster: config.name })
    if (yield* fs.exists(path)) return
    const spawner = yield* ChildProcessSpawnerNS.ChildProcessSpawner
    const creds = yield* ensureCredentials(options)(config.name)
    const sink = sopsCredentialsSinkLive({ dir: sops.dir, ageRecipient: sops.ageRecipient, spawner, fs })
    yield* Effect.flatMap(CredentialsSink, (s) => s.write(_credentialEntries({ config, creds, buckets: ensured }))).pipe(
      Effect.provide(sink)
    )
  })

// Force-deletes the object-storage service only when every configured bucket is retain:false.
export const reconcileUpcloudObjectStorageOnDelete = (
  config: UpcloudUksClusterConfig
): Effect.Effect<
  { readonly kept: ReadonlyArray<string>; readonly deleted: ReadonlyArray<string> },
  ObjectStorageError,
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
    const allNonRetained = buckets.every((b) => !b.retain)
    if (allNonRetained) {
      const services = yield* mapUpcloudError({
        self: objectStorage.services.list(),
        ctx: { kind: "object-storage-service", ref: config.name }
      })
      const service = services.find((s) => s.name === `${config.name}-objsto`)
      if (service !== undefined) {
        yield* mapUpcloudError({
          self: objectStorage.services.delete(service.uuid, true),
          ctx: { kind: "object-storage-service", ref: service.uuid }
        })
        // Network delete 409s until service deletion (async) finishes, so poll before continuing (live probe 2026-08-01).
        yield* _awaitServiceGone({ objectStorage, uuid: service.uuid })
      }
    }
    return { kept: buckets.filter((b) => b.retain).map((b) => b.name), deleted: toDelete.map((b) => b.name) }
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
