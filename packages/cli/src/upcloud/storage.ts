/**
 * `object_storage.module: "upcloud"` (M5/T6.1, R12/R14, AC1/AC5) —
 * plan/apply/delete for the D6 object-storage service + its buckets on the
 * `upcloud-uks` distro. Self-contained, mirroring `upcloud/volumes.ts`: this
 * module is only expressible on `upcloud-uks` (schema), so there is no
 * cross-distro machinery to share it with the ovh path in `storage/*.ts`.
 */
import { Effect, Redacted } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"
import { ConfigInvalid, CredentialsSink } from "@kumulo/core"
import type { BucketInfo, CredentialEntry, CredentialsSinkError, ObjectStorageError, PlanAction, S3Credentials } from "@kumulo/core"
import { credentialsPath, sopsCredentialsSinkLive } from "@kumulo/secrets-sops"
import { mapUpcloudError } from "@kumulo/upcloud"
import { deleteBucket, ensureBucket, ensureCredentials, listBuckets } from "@kumulo/storage-upcloud"
import type { UpcloudObjectStorageOptions } from "@kumulo/storage-upcloud"
import type { UpcloudUksClusterConfig } from "../cluster-config.ts"
import { UpcloudEnv } from "./env.ts"

/** Plan-row name for one configured bucket (mirrors the ovh path's `bucket/<name>`). */
export const uksBucketRow = (name: string): string => `bucket/${name}`
/** Plan-row name for the D6 object-storage service itself. */
export const uksObjectStorageRow = (cluster: string): string => `object-storage/${cluster}`

type ConfiguredBucket = Extract<UpcloudUksClusterConfig["object_storage"], { readonly module: "upcloud" }>["buckets"][number]

/** Configured buckets, empty unless `object_storage.module: "upcloud"`. */
export const configuredUpcloudBuckets = (config: UpcloudUksClusterConfig): ReadonlyArray<ConfiguredBucket> =>
  config.object_storage.module === "upcloud" ? config.object_storage.buckets : []

const _options = (config: UpcloudUksClusterConfig): Omit<UpcloudObjectStorageOptions, "client"> =>
  config.object_storage.module !== "upcloud"
    ? { cluster: config.name, region: "" }
    : { cluster: config.name, region: config.object_storage.region }

/** Bucket plan rows (AC5): existence live against the service (absent service reads as no buckets, i.e. every configured bucket plans Create). */
export const bucketPlanActions = (
  { config, live }: { readonly config: UpcloudUksClusterConfig; readonly live: ReadonlyArray<BucketInfo> }
): ReadonlyArray<PlanAction> => {
  const liveNames = new Set(live.map((b) => b.name))
  return configuredUpcloudBuckets(config).map((bucket) => {
    const name = uksBucketRow(bucket.name)
    return liveNames.has(bucket.name) ? { _tag: "NoOp" as const, name } : { _tag: "Create" as const, name }
  })
}

/** Live buckets for the plan/delete lookups; empty when the module isn't wired or the service doesn't exist yet. */
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

/**
 * Converges `object_storage.buckets` (R8): ensures every configured bucket
 * (the provider ensures the D6 service first), then issues S3 credentials
 * once (D7/R9) straight to the sops `CredentialsSink` — a re-run whose sink
 * file already exists skips `ensureCredentials` entirely, same as the ovh
 * path's `_ensureCredentialsIfMissing`. No-op for `module` other than
 * `"upcloud"`.
 */
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

/**
 * `delete` (R10/R14/D9): non-retained buckets deleted, retained ones
 * reported+kept; the D6 service itself is deleted with `?force=true` only
 * when every configured bucket is `retain: false` (D9) — a retained bucket
 * anywhere keeps the service alive so that bucket stays reachable.
 */
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
    // D9: force-delete the service only when nothing configured is retained
    // — a retained bucket keeps the service (and thus itself) alive.
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
      }
    }
    return { kept: buckets.filter((b) => b.retain).map((b) => b.name), deleted: toDelete.map((b) => b.name) }
  })
