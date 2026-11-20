import { paginate, ProviderApiError, VolumeProvider } from "@kumulo/core"
import type { ClusterTag, VolumeInfo, VolumeRef, VolumeSpec } from "@kumulo/core"
import { Effect, Layer } from "effect"
import type { HttpClient } from "effect/http"
import type { CinderAuth } from "./auth.ts"
import { cinderClient, type CinderClient } from "./client/cinder.ts"
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
    self: client.volumes.volumesDetailGet({ query: marker === undefined ? { limit: _pageSize } : { limit: _pageSize, marker } }),
    ref: _listRef
  })

const _maxPages = 100

const _firstMarker: string | undefined = undefined

const _listAll = (client: CinderClient): Effect.Effect<ReadonlyArray<VolumeRecord>, CinderError> =>
  paginate<string | undefined, VolumesDetailResponse, VolumeRecord, CinderError, never>({
    initial: _firstMarker,
    fetch: (marker) => _listPage({ client, marker }),
    items: (page) => page.volumes,
    // a non-advancing marker or an empty page ends the walk, otherwise it loops forever
    next: ({ cursor, items, page }) => {
      const next = nextMarker(page)

      return next === undefined || items.length === 0 || next === cursor ? undefined : next
    },
    maxPages: _maxPages
  }).pipe(
    Effect.catchTags({
      PaginationLimitExceeded: (error) =>
        Effect.fail(
          new ProviderApiError({ operation: `volume ${_listRef}`, status: 0, body: `more than ${error.maxPages} pages` })
        ),
      PaginationStalled: (error) =>
        Effect.fail(new ProviderApiError({ operation: `volume ${_listRef}`, status: 0, body: `stalled at ${error.cursor}` }))
    })
  )

// Cinder has no idempotency key — never wrap only the create POST in a retry policy, it would duplicate
export const ensureVolume = (
  { options, spec }: { readonly options: VolumeProviderOptions; readonly spec: VolumeSpec }
): R<VolumeInfo> =>
  Effect.gen(function*() {
    const client = yield* cinderClient
    const all = yield* _listAll(client)
    const existing = all.find((record) => (record.name ?? "") === spec.name && _metadataTag(record) === options.tag)

    if (existing !== undefined) return _volumeInfo(existing)

    const created = yield* mapCinderError({
      self: client.volumes.volumesPost({
        payload: {
          volume: spec.type === undefined
            ? { name: spec.name, size: spec.sizeGb, metadata: { [_tagMetadataKey]: options.tag } }
            : { name: spec.name, size: spec.sizeGb, volume_type: spec.type, metadata: { [_tagMetadataKey]: options.tag } }
        }
      }),
      ref: spec.name
    })

    return _volumeInfo(created.volume)
  })

export const listClusterVolumes = (tag: ClusterTag): R<ReadonlyArray<VolumeInfo>> =>
  Effect.flatMap(cinderClient, (client) =>
    Effect.map(_listAll(client), (all) => all.filter((record) => _metadataTag(record) === tag).map(_volumeInfo)))

export const deleteVolume = (ref: VolumeRef): R<void> =>
  Effect.flatMap(cinderClient, (client) =>
    mapCinderError({ self: client.volumes.volumesIdDelete({ params: { id: ref.id } }), ref: ref.id }).pipe(
      Effect.catchTag("ResourceNotFound", () => Effect.void),
      Effect.asVoid
    ))

export const cinderVolumeProviderLive = (options: VolumeProviderOptions): Layer.Layer<VolumeProvider, never, Deps> =>
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
