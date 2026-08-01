import { VolumeProvider } from "@kumulo/core"
import type { ClusterTag, VolumeInfo, VolumeRef, VolumeSpec } from "@kumulo/core"
import { Effect, Layer } from "effect"
import type { HttpClient } from "effect/unstable/http"
import type { CinderAuth } from "./auth.ts"
import { makeCinderClient, type CinderClient } from "./client/cinder.ts"
import { mapCinderError, type CinderError } from "./errors.ts"
import type { VolumeRecord, VolumesDetailResponse } from "./generated/cinder.ts"
import { staticPvManifest } from "./manifests.ts"

export interface VolumeProviderOptions {
  readonly tag: ClusterTag
}

type Deps = CinderAuth | HttpClient.HttpClient
type R<A> = Effect.Effect<A, CinderError, Deps>

const _tagMetadataKey = "kumulo_cluster"

const _listRef = "volumes/detail"

const _volumeInfo = (record: VolumeRecord): VolumeInfo => ({
  id: record.id,
  name: record.name ?? ""
})

const _metadataTag = (record: VolumeRecord): string => record.metadata?.kumulo_cluster ?? ""

// fixed page size, raise only if a cluster ever holds more volumes than round-trips are worth
const _pageSize = 100

export const nextMarker = (list: VolumesDetailResponse): string | undefined => {
  const next = list.volumes_links?.find((link) => link.rel === "next")
  if (next === undefined) return undefined
  const marker = new URL(next.href, "http://cinder.invalid/").searchParams.get("marker")
  return marker ?? list.volumes.at(-1)?.id
}

const _listPage = (
  { client, marker }: { readonly client: CinderClient; readonly marker: string | undefined }
): Effect.Effect<VolumesDetailResponse, CinderError> =>
  mapCinderError({
    self: client.volumes.volumesDetailGet({ query: { limit: _pageSize, ...(marker === undefined ? {} : { marker }) } }),
    ref: _listRef
  })

const _listFrom = (
  { client, marker, seen }: {
    readonly client: CinderClient
    readonly marker: string | undefined
    readonly seen: ReadonlyArray<VolumeRecord>
  }
): Effect.Effect<ReadonlyArray<VolumeRecord>, CinderError> =>
  _listPage({ client, marker }).pipe(Effect.flatMap((page) => {
    const acc = [...seen, ...page.volumes]
    const next = nextMarker(page)
    // also stops on a non-advancing marker — otherwise loops forever
    return next === undefined || page.volumes.length === 0 || next === marker
      ? Effect.succeed(acc)
      : _listFrom({ client, marker: next, seen: acc })
  }))

const _listAll = (client: CinderClient) => _listFrom({ client, marker: undefined, seen: [] })

// Cinder has no idempotency key — never wrap only the create POST in a retry policy, it would duplicate
export const ensureVolume = (
  { options, spec }: { readonly options: VolumeProviderOptions; readonly spec: VolumeSpec }
): R<VolumeInfo> =>
  Effect.gen(function*() {
    const client = yield* makeCinderClient
    const all = yield* _listAll(client)
    const existing = all.find((record) => (record.name ?? "") === spec.name && _metadataTag(record) === options.tag)
    if (existing !== undefined) return _volumeInfo(existing)
    const created = yield* mapCinderError({
      self: client.volumes.volumesPost({
        payload: {
          volume: {
            name: spec.name,
            size: spec.sizeGb,
            ...(spec.type === undefined ? {} : { volume_type: spec.type }),
            metadata: { [_tagMetadataKey]: options.tag }
          }
        }
      }),
      ref: spec.name
    })
    return _volumeInfo(created.volume)
  })

export const listClusterVolumes = (tag: ClusterTag): R<ReadonlyArray<VolumeInfo>> =>
  Effect.flatMap(makeCinderClient, (client) =>
    Effect.map(_listAll(client), (all) => all.filter((record) => _metadataTag(record) === tag).map(_volumeInfo)))

export const deleteVolume = (ref: VolumeRef): R<void> =>
  Effect.flatMap(makeCinderClient, (client) =>
    mapCinderError({ self: client.volumes.volumesIdDelete({ params: { id: ref.id } }), ref: ref.id }).pipe(
      Effect.catchTag("ResourceNotFound", () => Effect.void),
      Effect.asVoid
    ))

export const VolumeProviderLive = (options: VolumeProviderOptions): Layer.Layer<VolumeProvider, never, Deps> =>
  Layer.effect(
    VolumeProvider,
    Effect.gen(function*() {
      const context = yield* Effect.context<Deps>()
      const run = <A>(effect: R<A>) => Effect.provide(effect, context)
      return {
        ensureVolume: (spec: VolumeSpec) => run(ensureVolume({ options, spec })),
        listClusterVolumes: (tag: ClusterTag) => run(listClusterVolumes(tag)),
        deleteVolume: (ref: VolumeRef) => run(deleteVolume(ref)),
        staticPvManifest: (vol: VolumeInfo, spec: VolumeSpec) => staticPvManifest({ vol, spec })
      }
    })
  )
