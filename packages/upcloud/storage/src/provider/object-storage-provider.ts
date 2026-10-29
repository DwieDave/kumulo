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
  readonly privateNetworkUuid?: string
  readonly pollInterval?: Duration.Input
}

const _serviceName = (cluster: ClusterTag): string => `${cluster}-objsto`
export const objectStorageUsername = (cluster: ClusterTag): string => `${cluster}-kumulo`
const _username = objectStorageUsername

export const KUMULO_S3_POLICY = "ECSS3FullAccess"

// kumulo: static-website endpoints are also type "public"; only the api mode serves S3.
const _publicEndpoint = (service: ObjectStorageService): string =>
  service.endpoints?.find((e) => e.type === "public" && (e.mode === undefined || e.mode === "api"))?.domain_name ?? ""

const _findService = (
  { client, cluster }: { readonly client: ObjectStorageClient; readonly cluster: ClusterTag }
): Effect.Effect<ObjectStorageService | undefined, ObjectStorageError> =>
  Effect.map(
    mapUpcloudError({ self: client.services.list(), ctx: { kind: "object-storage-service", ref: cluster } }),
    (services) => services.find((s) => s.name === _serviceName(cluster))
  )

const _networks = (options: UpcloudObjectStorageOptions) => [
  { name: "public", type: "public" as const, family: "IPv4" },
  ...(options.privateNetworkUuid === undefined
    ? []
    : [{ name: "private", type: "private" as const, family: "IPv4", uuid: options.privateNetworkUuid }])
]

const _isDeleting = (service: ObjectStorageService): boolean => service.operational_state.startsWith("delete-")

const _deletingError = (cluster: ClusterTag, service: ObjectStorageService) =>
  new ProviderApiError({
    operation: `object-storage-service ${cluster}`,
    status: 0,
    body: `service ${service.uuid} is being deleted (operational_state: ${service.operational_state}) — wait for the deletion to finish, then re-run apply`
  })

const _awaitRunning = (
  { client, uuid, cluster, pollInterval }: {
    readonly client: ObjectStorageClient
    readonly uuid: string
    readonly cluster: ClusterTag
    readonly pollInterval: Duration.Input
  }
): Effect.Effect<ObjectStorageService, ObjectStorageError> =>
  pollUntil({
    check: mapUpcloudError({ self: client.services.get(uuid), ctx: { kind: "object-storage-service", ref: cluster } }).pipe(
      Effect.filterOrFail((service) => !_isDeleting(service), (service) => _deletingError(cluster, service))
    ),
    isDone: (service) => service.operational_state === "running",
    interval: pollInterval,
    timeout: "20 minutes",
    describe: (service) => service.operational_state,
    kind: "object-storage-service",
    ref: cluster
  }).pipe(
    Effect.catchTag("ProvisioningTimeout", (e) =>
      Effect.fail(new ProviderApiError({ operation: `object-storage-service ${cluster}`, status: 0, body: `not running after 20 minutes (last operational_state: ${e.lastStatus}) — UpCloud certificate provisioning can be slow; re-run apply to keep waiting` })))
  )

export const ensureService = (
  options: UpcloudObjectStorageOptions
): Effect.Effect<ObjectStorageService, ObjectStorageError> =>
  Effect.gen(function*() {
    const { client, cluster, region } = options
    const existing = yield* _findService({ client, cluster })

    if (existing !== undefined && _isDeleting(existing)) return yield* Effect.fail(_deletingError(cluster, existing))

    if (existing !== undefined && existing.configured_status === "stopped") {
      yield* mapUpcloudError({
        self: client.services.patch(existing.uuid, { configured_status: "started" }),
        ctx: { kind: "object-storage-service", ref: cluster }
      })
    } else if (existing !== undefined && existing.operational_state === "running") return existing

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
  { client, serviceUuid, spec, pollInterval }: {
    readonly client: ObjectStorageClient
    readonly serviceUuid: string
    readonly spec: BucketSpec
    readonly pollInterval: Duration.Input
  }
): Effect.Effect<void, ObjectStorageError> =>
  Effect.gen(function*() {
    const ctx = { kind: "bucket", ref: `${serviceUuid}/${spec.name}` }
    const buckets = yield* mapUpcloudError({ self: client.buckets.list(serviceUuid), ctx })

    if (buckets.some((b) => b.name === spec.name && !b.deleted)) return

    if (buckets.some((b) => b.name === spec.name)) {
      yield* pollUntil({
        check: mapUpcloudError({ self: client.buckets.list(serviceUuid), ctx }),
        isDone: (current) => !current.some((b) => b.name === spec.name && b.deleted === true),
        interval: pollInterval,
        timeout: "10 minutes",
        describe: () => "deleting",
        kind: "bucket",
        ref: `${serviceUuid}/${spec.name}`
      }).pipe(
        Effect.catchTag("ProvisioningTimeout", () =>
          Effect.fail(new ProviderApiError({ operation: `bucket ${spec.name}`, status: 0, body: "the previous bucket of this name is still being deleted after 10 minutes — re-run apply" })))
      )
    }

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
  (spec: BucketSpec, existing?: ObjectStorageService): Effect.Effect<BucketInfo, ObjectStorageError> =>
    Effect.gen(function*() {
      const service = existing ?? (yield* ensureService(options))

      yield* _ensureBucketInService({
        client: options.client,
        serviceUuid: service.uuid,
        spec,
        pollInterval: options.pollInterval ?? "3 seconds"
      })

      return { name: spec.name, region: options.region, endpoint: _publicEndpoint(service) }
    })

// refuses BucketNotEmpty when the API reports objects still in it — no force in v1.
// The metrics come from a single list taken right before the DELETE.
export const deleteBucket = (options: UpcloudObjectStorageOptions) =>
  (ref: BucketRef): Effect.Effect<void, ObjectStorageError> =>
    Effect.gen(function*() {
      const service = yield* _findService(options)

      if (service === undefined) return
      const ctx = { kind: "bucket", ref: `${service.uuid}/${ref.name}` }

      const buckets = yield* mapUpcloudError({ self: options.client.buckets.list(service.uuid), ctx })
      const fresh = buckets.find((b) => b.name === ref.name && !b.deleted)

      if (fresh === undefined) return

      if (fresh.total_objects > 0) {
        return yield* Effect.fail(new BucketNotEmpty({ bucket: ref.name, objectCount: fresh.total_objects }))
      }

      yield* mapUpcloudError({ self: options.client.buckets.delete(service.uuid, ref.name), ctx })
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

const _ensurePolicy = (
  { client, serviceUuid, username }: { readonly client: ObjectStorageClient; readonly serviceUuid: string; readonly username: string }
): Effect.Effect<void, ObjectStorageError> =>
  Effect.gen(function*() {
    const ctx = { kind: "object-storage-user-policy", ref: username }
    const attached = yield* mapUpcloudError({ self: client.users.policies.list(serviceUuid, username), ctx })

    if (attached.some((p) => p.name === KUMULO_S3_POLICY)) return
    yield* mapUpcloudError({ self: client.users.policies.attach(serviceUuid, username, KUMULO_S3_POLICY), ctx })
  })

export const ensureUserAccess = (options: UpcloudObjectStorageOptions) =>
  (clusterName: ClusterTag): Effect.Effect<void, ObjectStorageError> =>
    Effect.gen(function*() {
      const service = yield* ensureService(options)
      const username = _username(clusterName)
      yield* _ensureUser({ client: options.client, serviceUuid: service.uuid, username })
      yield* _ensurePolicy({ client: options.client, serviceUuid: service.uuid, username })
    })

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
      const service = yield* ensureService(options)
      const username = _username(clusterName)
      yield* _ensureUser({ client: options.client, serviceUuid: service.uuid, username })
      yield* _ensurePolicy({ client: options.client, serviceUuid: service.uuid, username })
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
