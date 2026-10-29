import { Effect, Layer, Option, Predicate, Redacted } from "effect"
import { BucketNotEmpty, ObjectStorageProvider, ProviderApiError, ResourceConflict, ResourceNotFound } from "@kumulo/core"
import type {
  BucketCredential,
  BucketInfo,
  BucketRef,
  ClusterTag,
  ObjectStorageError,
  S3Credentials
} from "@kumulo/core"
import type { BunnyError, BunnyStorageClient, BunnyStorageZone } from "@kumulo/bunny"
import type { BunnyBucketSpec, BunnyTier } from "./diff.ts"
import type { OutputsBucket } from "./outputs.ts"

export interface EnsuredZone {
  readonly info: BucketInfo
  readonly bucket: OutputsBucket
}

const _kind = "storage-zone"

const _toStorageError = (error: BunnyError): ObjectStorageError =>
  Predicate.isTagged(error, "CapabilityMissing")
    ? new ProviderApiError({ operation: error.capability, status: 0, body: error.workaround ?? error.region })
    : error

const _mapped = <A>(self: Effect.Effect<A, BunnyError>): Effect.Effect<A, ObjectStorageError> =>
  Effect.mapError(self, _toStorageError)

const _endpoint = (zone: BunnyStorageZone): string =>
  zone.S3Hostname ? `https://${zone.S3Hostname}` : `https://${zone.Region.toLowerCase()}-s3.storage.bunnycdn.com`

const _toInfo = (zone: BunnyStorageZone): BucketInfo => ({
  name: zone.Name,
  region: zone.Region,
  endpoint: _endpoint(zone)
})

const _tier = (zone: BunnyStorageZone): BunnyTier => (zone.ZoneTier === "Edge" ? "edge" : "standard")

const _credential = (zone: BunnyStorageZone): BucketCredential => ({
  ..._toInfo(zone),
  accessKey: Redacted.make(zone.Name),
  secretKey: Redacted.make(zone.Password ?? "")
})

export const makeBunnyObjectStorageProvider = (
  { owned, storage }: { readonly storage: BunnyStorageClient; readonly owned: ReadonlyArray<OutputsBucket> }
) => {
  const ownedByName = new Map(owned.map((bucket) => [bucket.name, bucket]))

  const ensureZone = (spec: BunnyBucketSpec): Effect.Effect<EnsuredZone, ObjectStorageError> =>
    Effect.gen(function*() {
      const mine = ownedByName.get(spec.name)

      if (mine !== undefined) {
        const zone = yield* _mapped(storage.getZone(mine.id))

        return { info: _toInfo(zone), bucket: { ...mine, region: zone.Region, tier: _tier(zone) } }
      }

      const available = yield* _mapped(storage.checkAvailability(spec.name))

      if (!available) return yield* Effect.fail(new ResourceConflict({ kind: _kind, ref: spec.name }))

      const zone = yield* _mapped(storage.createZone({
        name: spec.name,
        region: spec.region,
        zoneTier: spec.tier === "edge" ? "Edge" : "Standard"
      }))

      return {
        info: _toInfo(zone),
        bucket: { id: zone.Id, name: zone.Name, region: zone.Region, tier: _tier(zone), retain: spec.retain }
      }
    })

  const listBuckets = (region: string): Effect.Effect<ReadonlyArray<BucketInfo>, ObjectStorageError> =>
    Effect.map(
      _mapped(storage.listZones()),
      (zones) => zones.filter((zone) => zone.Region === region && ownedByName.has(zone.Name)).map(_toInfo)
    )

  const ensureBucket = (spec: BunnyBucketSpec): Effect.Effect<BucketInfo, ObjectStorageError> =>
    Effect.map(ensureZone(spec), (ensured) => ensured.info)

  const deleteBucket = (ref: BucketRef): Effect.Effect<void, ObjectStorageError> =>
    Effect.gen(function*() {
      const mine = ownedByName.get(ref.name)

      if (mine === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: _kind, ref: ref.name }))

      if (mine.retain) return

      const zone = yield* _mapped(storage.getZone(mine.id)).pipe(
        Effect.map(Option.some),
        Effect.catchTag("ResourceNotFound", () => Effect.succeed(Option.none<BunnyStorageZone>()))
      )

      if (Option.isNone(zone)) return

      if (zone.value.FilesStored > 0) {
        return yield* Effect.fail(new BucketNotEmpty({ bucket: ref.name, objectCount: zone.value.FilesStored }))
      }

      yield* _mapped(storage.deleteZone(mine.id))
    })

  const ensureCredentials = (clusterName: ClusterTag): Effect.Effect<S3Credentials, ObjectStorageError> =>
    Effect.map(
      Effect.forEach(owned, (bucket) => _mapped(storage.getZone(bucket.id))),
      (zones) => ({
        user: `kumulo-${clusterName}`,
        accessKey: Redacted.make(""),
        secretKey: Redacted.make(""),
        buckets: zones.map(_toInfo),
        bucketCredentials: zones.map(_credential)
      })
    )

  return { listBuckets, ensureBucket, ensureZone, deleteBucket, ensureCredentials }
}

export const bunnyObjectStorageProviderLive = (
  input: { readonly storage: BunnyStorageClient; readonly owned: ReadonlyArray<OutputsBucket> }
) => {
  const { deleteBucket, ensureBucket, ensureCredentials, listBuckets } = makeBunnyObjectStorageProvider(input)

  return Layer.succeed(ObjectStorageProvider, {
    listBuckets,
    ensureBucket,
    deleteBucket,
    ensureCredentials
  })
}
