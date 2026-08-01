import { Effect, Layer, Redacted, Schedule } from "effect"
import { BucketNotEmpty, ObjectStorageProvider, ProviderApiError, ResourceNotFound } from "@kumulo/core"
import type { BucketInfo, BucketRef, BucketSpec, ClusterTag, ObjectStorageError, S3Credentials } from "@kumulo/core"
import type { Cloud_StorageContainer, Cloud_storage_VersioningStatusEnum, Cloud_user_User, Storage } from "../generated/client.ts"
import { mapStorageError } from "./errors.ts"

type Container = Cloud_StorageContainer

interface ContainerLike {
  readonly name?: string
  readonly region?: string
  readonly virtualHost?: string
}

const _userTag = (clusterName: ClusterTag): string => `kumulo-${clusterName}`

const _versioningStatus = (versioning: boolean): Cloud_storage_VersioningStatusEnum => versioning ? "enabled" : "disabled"

const _toBucketInfo = (container: ContainerLike, region: string): BucketInfo => ({
  name: container.name ?? "",
  region: container.region ?? region,
  endpoint: container.virtualHost ?? ""
})

const _create = (
  { storage, serviceName, spec }: { readonly storage: Storage; readonly serviceName: string; readonly spec: BucketSpec }
): Effect.Effect<Container, ObjectStorageError> =>
  mapStorageError({
    self: storage.createStorageContainerOnRegion(serviceName, spec.region, {
      payload: {
        name: spec.name,
        versioning: { status: _versioningStatus(spec.versioning) },
        encryption: { sseAlgorithm: spec.encryption ? "AES256" : "plaintext" }
      }
    }),
    ctx: { kind: "bucket", ref: `${spec.region}/${spec.name}` }
  })

const _update = (
  { storage, serviceName, spec }: { readonly storage: Storage; readonly serviceName: string; readonly spec: BucketSpec }
): Effect.Effect<Container, ObjectStorageError> =>
  mapStorageError({
    self: storage.updateStorageContainerOnRegion(serviceName, spec.region, spec.name, {
      payload: { versioning: { status: _versioningStatus(spec.versioning) } }
    }),
    ctx: { kind: "bucket", ref: `${spec.region}/${spec.name}` }
  })

const _ensureContainer = (
  { storage, serviceName, spec }: { readonly storage: Storage; readonly serviceName: string; readonly spec: BucketSpec }
): Effect.Effect<Container, ObjectStorageError> =>
  Effect.gen(function*() {
    const ctx = { kind: "bucket", ref: `${spec.region}/${spec.name}` }
    const containers = yield* mapStorageError({
      self: storage.getStorageContainersOnRegion(serviceName, spec.region, undefined),
      ctx: { kind: "storage-region", ref: spec.region }
    })
    if (!containers.some((c) => c.name === spec.name)) return yield* _create({ storage, serviceName, spec })
    const current = yield* mapStorageError({ self: storage.getStorageContainerOnRegion(serviceName, spec.region, spec.name, undefined), ctx })
    if ((current.versioning?.status === "enabled") === spec.versioning) return current
    return yield* _update({ storage, serviceName, spec })
  })

const _findUser = (
  { storage, serviceName, username }: { readonly storage: Storage; readonly serviceName: string; readonly username: string }
): Effect.Effect<Cloud_user_User | undefined, ObjectStorageError> =>
  Effect.map(
    mapStorageError({
      self: storage.getCloudProjectServiceNameUser(serviceName, undefined),
      ctx: { kind: "s3-user", ref: username }
    }),
    (users) => users.find((u) => u.description === username)
  )

const _awaitUserReady = (
  { storage, serviceName, userId, username }: {
    readonly storage: Storage
    readonly serviceName: string
    readonly userId: string
    readonly username: string
  }
): Effect.Effect<Cloud_user_User, ObjectStorageError> =>
  mapStorageError({
    self: storage.getCloudProjectServiceNameUserUserId(serviceName, userId, undefined),
    ctx: { kind: "s3-user", ref: username }
  }).pipe(
    Effect.flatMap((user) =>
      user.status === "ok"
        ? Effect.succeed(user)
        : Effect.fail(new ResourceNotFound({ kind: "s3-user", ref: `${username} (status: ${user.status ?? "unknown"})` }))
    ),
    Effect.retry({
      schedule: Schedule.spaced("3 seconds").pipe(Schedule.upTo({ duration: "2 minutes" })),
      while: (error) => error._tag === "ResourceNotFound"
    })
  )

const _ensureUser = (
  { storage, serviceName, username }: { readonly storage: Storage; readonly serviceName: string; readonly username: string }
): Effect.Effect<Cloud_user_User, ObjectStorageError> =>
  Effect.gen(function*() {
    const existing = yield* _findUser({ storage, serviceName, username })
    const user = existing ?? (yield* mapStorageError({
      self: storage.postCloudProjectServiceNameUser(serviceName, { payload: { description: username, role: "objectstore_operator" } }),
      ctx: { kind: "s3-user", ref: username }
    }))
    if (user.status === "ok" || user.id === undefined) return user
    return yield* _awaitUserReady({ storage, serviceName, userId: String(user.id), username })
  })

// OVH only ever returns an S3 secret once (create response); a credential found here is an unrecoverable orphan — deleting and re-issuing is safe.
const _deleteOrphanedCredentials = (
  { storage, serviceName, userId, username, existing }: {
    readonly storage: Storage
    readonly serviceName: string
    readonly userId: string
    readonly username: string
    readonly existing: ReadonlyArray<{ readonly access?: string }>
  }
): Effect.Effect<void, ObjectStorageError> =>
  Effect.forEach(
    existing.flatMap((cred) => (cred.access === undefined ? [] : [cred.access])),
    (access) =>
      mapStorageError({
        self: storage.deleteCloudProjectServiceNameUserUserIdS3CredentialsAccess(serviceName, userId, access, undefined),
        ctx: { kind: "s3-credential", ref: `${username}/${access}` }
      }),
    { discard: true }
  )

export const listBuckets = (
  { storage, serviceName }: { readonly storage: Storage; readonly serviceName: string }
) =>
  (region: string): Effect.Effect<ReadonlyArray<BucketInfo>, ObjectStorageError> =>
    Effect.map(
      mapStorageError({ self: storage.getStorageContainersOnRegion(serviceName, region, undefined), ctx: { kind: "storage-region", ref: region } }),
      (containers) => containers.map((c) => _toBucketInfo(c, region))
    )

export const ensureBucket = (
  { storage, serviceName }: { readonly storage: Storage; readonly serviceName: string }
) =>
  (spec: BucketSpec): Effect.Effect<BucketInfo, ObjectStorageError> =>
    Effect.map(_ensureContainer({ storage, serviceName, spec }), (container) => _toBucketInfo(container, spec.region))

export const deleteBucket = (
  { storage, serviceName }: { readonly storage: Storage; readonly serviceName: string }
) =>
  (ref: BucketRef): Effect.Effect<void, ObjectStorageError> =>
    Effect.gen(function*() {
      const ctx = { kind: "bucket", ref: `${ref.region}/${ref.name}` }
      const container = yield* mapStorageError({
        self: storage.getStorageContainerOnRegion(serviceName, ref.region, ref.name, { params: { noObjects: true } }),
        ctx
      })
      // Absent objectsCount means "unknown", not "empty" — refuse rather than delete a bucket whose contents we couldn't verify.
      if (container.objectsCount === undefined) {
        return yield* Effect.fail(
          new ProviderApiError({ operation: `bucket ${ctx.ref}`, status: 200, body: "response omitted objectsCount; refusing to delete" })
        )
      }
      if (container.objectsCount > 0) return yield* Effect.fail(new BucketNotEmpty({ bucket: ref.name, objectCount: container.objectsCount }))
      yield* mapStorageError({ self: storage.deteteStorageContainerOnRegion(serviceName, ref.region, ref.name, undefined), ctx })
    })

export const ensureCredentials = (
  { storage, serviceName }: { readonly storage: Storage; readonly serviceName: string }
) =>
  (clusterName: ClusterTag): Effect.Effect<S3Credentials, ObjectStorageError> =>
    Effect.gen(function*() {
      const username = _userTag(clusterName)
      const user = yield* _ensureUser({ storage, serviceName, username })
      const ctx = { kind: "s3-credential", ref: username }
      if (user.id === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "s3-user", ref: username }))
      const userId = String(user.id)
      const existing = yield* mapStorageError({
        self: storage.getCloudProjectServiceNameUserUserIdS3Credentials(serviceName, userId, undefined),
        ctx
      })
      if (existing.length > 0) yield* _deleteOrphanedCredentials({ storage, serviceName, userId, username, existing })
      const created = yield* mapStorageError({
        self: storage.postCloudProjectServiceNameUserUserIdS3Credentials(serviceName, userId, undefined),
        ctx
      })
      return {
        user: username,
        accessKey: Redacted.make(created.access ?? ""),
        secretKey: Redacted.make(created.secret ?? ""),
        buckets: []
      }
    })

export const makeOvhObjectStorageProvider = (
  { storage, serviceName }: { readonly storage: Storage; readonly serviceName: string }
) => ({
  listBuckets: listBuckets({ storage, serviceName }),
  ensureBucket: ensureBucket({ storage, serviceName }),
  deleteBucket: deleteBucket({ storage, serviceName }),
  ensureCredentials: ensureCredentials({ storage, serviceName })
})

export const ovhObjectStorageProviderLive = (
  { storage, serviceName }: { readonly storage: Storage; readonly serviceName: string }
) => Layer.succeed(ObjectStorageProvider, makeOvhObjectStorageProvider({ storage, serviceName }))
