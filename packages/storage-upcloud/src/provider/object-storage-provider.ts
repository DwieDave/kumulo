/**
 * `ObjectStorageProvider` over UpCloud's `/object-storage-2` (R8-R11, D6-D8).
 * One service per cluster, deterministic name `<cluster>-objsto` — every
 * bucket, and the single `<cluster>-kumulo` IAM user, live inside it.
 */
import { Effect, Layer, Redacted } from "effect"
import type { Duration } from "effect"
import { BucketNotEmpty, ObjectStorageProvider, pollUntil, ProviderApiError, ResourceNotFound } from "@kumulo/core"
import type { BucketInfo, BucketRef, BucketSpec, ClusterTag, ObjectStorageError, S3Credentials } from "@kumulo/core"
import { mapUpcloudError } from "@kumulo/upcloud"
import type { AccessKey, ObjectStorageClient, ObjectStorageService } from "@kumulo/upcloud"

export interface UpcloudObjectStorageOptions {
  readonly client: ObjectStorageClient
  readonly cluster: ClusterTag
  readonly region: string
  /** SDN network uuid for the cluster's private attachment (D6) — the CLI wires this, optional here. */
  readonly privateNetworkUuid?: string
  /** Service-ready poll interval (N2) — defaults to 3s; tests shrink this to avoid real multi-poll waits. */
  readonly pollInterval?: Duration.Input
}

const _serviceName = (cluster: ClusterTag): string => `${cluster}-objsto`
const _username = (cluster: ClusterTag): string => `${cluster}-kumulo`

const _publicEndpoint = (service: ObjectStorageService): string =>
  service.endpoints?.find((e) => e.type === "public")?.domain_name ?? ""

const _findService = (
  { client, cluster }: { readonly client: ObjectStorageClient; readonly cluster: ClusterTag }
): Effect.Effect<ObjectStorageService | undefined, ObjectStorageError> =>
  Effect.map(
    mapUpcloudError({ self: client.services.list(), ctx: { kind: "object-storage-service", ref: cluster } }),
    (services) => services.find((s) => s.name === _serviceName(cluster))
  )

// D6: one public attachment always, plus one private attachment when the
// cluster's SDN network uuid is known.
const _networks = (options: UpcloudObjectStorageOptions) => [
  { name: "public", type: "public" as const, family: "IPv4" },
  ...(options.privateNetworkUuid === undefined
    ? []
    : [{ name: "private", type: "private" as const, family: "IPv4", uuid: options.privateNetworkUuid }])
]

const _awaitRunning = (
  { client, uuid, cluster, pollInterval }: {
    readonly client: ObjectStorageClient
    readonly uuid: string
    readonly cluster: ClusterTag
    readonly pollInterval: Duration.Input
  }
): Effect.Effect<ObjectStorageService, ObjectStorageError> =>
  pollUntil({
    check: mapUpcloudError({ self: client.services.get(uuid), ctx: { kind: "object-storage-service", ref: cluster } }),
    isDone: (service) => service.operational_state === "running",
    interval: pollInterval,
    // Live probe 2026-08-01: certificate provisioning on UpCloud's side can
    // hold a fresh service in setup-* for 10+ minutes.
    timeout: "20 minutes",
    describe: (service) => service.operational_state,
    kind: "object-storage-service",
    ref: cluster
  }).pipe(
    Effect.catchTag("ProvisioningTimeout", (e) =>
      Effect.fail(new ProviderApiError({ operation: `object-storage-service ${cluster}`, status: 0, body: `not running after 20 minutes (last operational_state: ${e.lastStatus}) — UpCloud certificate provisioning can be slow; re-run apply to keep waiting` })))
  )

/** Get-or-create the D6 service, awaited to `operational_state: "running"`. */
const _ensureService = (
  options: UpcloudObjectStorageOptions
): Effect.Effect<ObjectStorageService, ObjectStorageError> =>
  Effect.gen(function*() {
    const { client, cluster, region } = options
    const existing = yield* _findService({ client, cluster })
    if (existing !== undefined && existing.operational_state === "running") return existing
    const service = existing ?? (yield* mapUpcloudError({
      self: client.services.create({
        name: _serviceName(cluster),
        region,
        configured_status: "started",
        networks: _networks(options)
      }),
      ctx: { kind: "object-storage-service", ref: cluster }
    }))
    return yield* _awaitRunning({ client, uuid: service.uuid, cluster, pollInterval: options.pollInterval ?? "3 seconds" })
  })

const _ensureBucketInService = (
  { client, serviceUuid, spec }: { readonly client: ObjectStorageClient; readonly serviceUuid: string; readonly spec: BucketSpec }
): Effect.Effect<void, ObjectStorageError> =>
  Effect.gen(function*() {
    const ctx = { kind: "bucket", ref: `${serviceUuid}/${spec.name}` }
    // R11: async delete leaves `deleted: true` entries for one poll — filter them out.
    const buckets = yield* mapUpcloudError({ self: client.buckets.list(serviceUuid), ctx })
    if (buckets.some((b) => b.name === spec.name && !b.deleted)) return
    yield* mapUpcloudError({ self: client.buckets.create(serviceUuid, spec.name), ctx })
  })

export const listBuckets = (options: UpcloudObjectStorageOptions) =>
  (_region: string): Effect.Effect<ReadonlyArray<BucketInfo>, ObjectStorageError> =>
    Effect.gen(function*() {
      const service = yield* _findService(options)
      if (service === undefined) return []
      const buckets = yield* mapUpcloudError({
        self: options.client.buckets.list(service.uuid),
        ctx: { kind: "object-storage-service", ref: options.cluster }
      })
      const endpoint = _publicEndpoint(service)
      return buckets.filter((b) => !b.deleted).map((b) => ({ name: b.name, region: options.region, endpoint }))
    })

export const ensureBucket = (options: UpcloudObjectStorageOptions) =>
  (spec: BucketSpec): Effect.Effect<BucketInfo, ObjectStorageError> =>
    Effect.gen(function*() {
      const service = yield* _ensureService(options)
      yield* _ensureBucketInService({ client: options.client, serviceUuid: service.uuid, spec })
      return { name: spec.name, region: options.region, endpoint: _publicEndpoint(service) }
    })

/** Refuses (`BucketNotEmpty`) when the API reports the bucket still holds objects (R10) — no force in v1. */
export const deleteBucket = (options: UpcloudObjectStorageOptions) =>
  (ref: BucketRef): Effect.Effect<void, ObjectStorageError> =>
    Effect.gen(function*() {
      const service = yield* _findService(options)
      if (service === undefined) return
      const ctx = { kind: "bucket", ref: `${service.uuid}/${ref.name}` }
      const buckets = yield* mapUpcloudError({ self: options.client.buckets.list(service.uuid), ctx })
      const bucket = buckets.find((b) => b.name === ref.name && !b.deleted)
      if (bucket === undefined) return
      if (bucket.total_objects > 0) {
        return yield* Effect.fail(new BucketNotEmpty({ bucket: ref.name, objectCount: bucket.total_objects }))
      }
      yield* mapUpcloudError({ self: options.client.buckets.delete(service.uuid, ref.name), ctx }).pipe(
        Effect.catchTag("ResourceConflict", () => Effect.fail(new BucketNotEmpty({ bucket: ref.name, objectCount: bucket.total_objects })))
      )
    })

const _ensureUser = (
  { client, serviceUuid, username }: { readonly client: ObjectStorageClient; readonly serviceUuid: string; readonly username: string }
): Effect.Effect<void, ObjectStorageError> =>
  Effect.gen(function*() {
    const ctx = { kind: "object-storage-user", ref: username }
    const found = yield* mapUpcloudError({ self: client.users.get(serviceUuid, username), ctx }).pipe(
      Effect.catchTag("ResourceNotFound", () => Effect.succeed(undefined))
    )
    if (found !== undefined) return
    yield* mapUpcloudError({ self: client.users.create(serviceUuid, username), ctx })
  })

// D7: the secret exists only in the create response. A prior access key with
// no recoverable secret (this run has no cached one — the reconcile layer
// only calls `ensureCredentials` when the sink is empty) is rotated: delete,
// then create fresh.
const _rotateAccessKey = (
  { client, serviceUuid, username }: { readonly client: ObjectStorageClient; readonly serviceUuid: string; readonly username: string }
): Effect.Effect<AccessKey, ObjectStorageError> =>
  Effect.gen(function*() {
    const ctx = { kind: "object-storage-access-key", ref: username }
    const existing = yield* mapUpcloudError({ self: client.accessKeys.list(serviceUuid, username), ctx })
    yield* Effect.forEach(
      existing,
      (key) => mapUpcloudError({ self: client.accessKeys.delete(serviceUuid, username, key.access_key_id), ctx }),
      { discard: true }
    )
    return yield* mapUpcloudError({ self: client.accessKeys.create(serviceUuid, username), ctx })
  })

export const ensureCredentials = (options: UpcloudObjectStorageOptions) =>
  (clusterName: ClusterTag): Effect.Effect<S3Credentials, ObjectStorageError> =>
    Effect.gen(function*() {
      const service = yield* _ensureService(options)
      const username = _username(clusterName)
      yield* _ensureUser({ client: options.client, serviceUuid: service.uuid, username })
      const key = yield* _rotateAccessKey({ client: options.client, serviceUuid: service.uuid, username })
      if (key.secret_access_key === undefined) {
        return yield* Effect.fail(new ResourceNotFound({ kind: "object-storage-access-key", ref: username }))
      }
      return {
        user: username,
        accessKey: Redacted.make(key.access_key_id),
        secretKey: Redacted.make(key.secret_access_key),
        buckets: []
      }
    })

export const makeUpcloudObjectStorageProvider = (options: UpcloudObjectStorageOptions) => ({
  listBuckets: listBuckets(options),
  ensureBucket: ensureBucket(options),
  deleteBucket: deleteBucket(options),
  ensureCredentials: ensureCredentials(options)
})

export const upcloudObjectStorageProviderLive = (options: UpcloudObjectStorageOptions) =>
  Layer.succeed(ObjectStorageProvider, makeUpcloudObjectStorageProvider(options))
