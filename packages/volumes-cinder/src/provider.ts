import { VolumeProvider } from "@kumulo/core"
import type { ClusterTag, VolumeInfo, VolumeRef, VolumeSpec } from "@kumulo/core"
import { Effect, Layer } from "effect"
import type { HttpClient } from "effect/unstable/http"
import type { CinderAuth } from "./auth.ts"
import { cinderRequest } from "./rest.ts"
import type { CinderError } from "./rest.ts"
import { decodeVolumeSingle, decodeVolumesList, nextMarker, type VolumeRecord, type VolumesList } from "./schemas.ts"
import { staticPvManifest } from "./manifests.ts"

export interface VolumeProviderOptions {
  readonly tag: ClusterTag
}

type Deps = CinderAuth | HttpClient.HttpClient
type R<A> = Effect.Effect<A, CinderError, Deps>

// kumulo: Cinder volume metadata carries no first-class "cluster" concept —
// this key is our own tagging convention, mirroring the CloudProvider's
// ensure-by-tag+name scheme.
const _tagMetadataKey = "kumulo_cluster"

const _volumeInfo = (record: VolumeRecord): VolumeInfo => ({
  id: record.id,
  name: record.name ?? ""
})

const _metadataTag = (record: VolumeRecord): string => record.metadata?.kumulo_cluster ?? ""

// ponytail: fixed page size, marker-paged. Cinder caps the page at its own
// `osapi_max_limit` anyway; raise only if a cluster ever holds more volumes
// than round-trips are worth.
const _pageSize = 100

const _listPage = (marker: string | undefined): R<VolumesList> =>
  cinderRequest({
    path: marker === undefined
      ? `volumes/detail?limit=${_pageSize}`
      : `volumes/detail?limit=${_pageSize}&marker=${encodeURIComponent(marker)}`,
    method: "GET",
    ref: "volumes"
  }).pipe(Effect.flatMap(decodeVolumesList))

const _listFrom = (
  marker: string | undefined,
  seen: ReadonlyArray<VolumeRecord>
): R<ReadonlyArray<VolumeRecord>> =>
  _listPage(marker).pipe(Effect.flatMap((page) => {
    const acc = [...seen, ...page.volumes]
    const next = nextMarker(page)
    // kumulo: stop on no-next, on an empty page, and on a marker that does
    // not advance — a stuck marker would otherwise loop forever.
    return next === undefined || page.volumes.length === 0 || next === marker
      ? Effect.succeed(acc)
      : _listFrom(next, acc)
  }))

const _listAll = (): R<ReadonlyArray<VolumeRecord>> => _listFrom(undefined, [])

// kumulo: list-then-create. Idempotent across whole-call retries (the
// tag+name lookup finds the earlier volume), but Cinder offers no
// idempotency key, so a retry of the POST itself would duplicate — never
// wrap only the create in a retry policy.
export const ensureVolume = (
  { options, spec }: { readonly options: VolumeProviderOptions; readonly spec: VolumeSpec }
): R<VolumeInfo> =>
  Effect.gen(function*() {
    const all = yield* _listAll()
    const existing = all.find((record) => (record.name ?? "") === spec.name && _metadataTag(record) === options.tag)
    if (existing !== undefined) return _volumeInfo(existing)
    const created = yield* cinderRequest({
      path: "volumes",
      method: "POST",
      ref: spec.name,
      body: {
        volume: {
          name: spec.name,
          size: spec.sizeGb,
          volume_type: spec.type,
          metadata: { [_tagMetadataKey]: options.tag }
        }
      }
    }).pipe(Effect.flatMap(decodeVolumeSingle))
    return _volumeInfo(created)
  })

export const listClusterVolumes = (tag: ClusterTag): R<ReadonlyArray<VolumeInfo>> =>
  _listAll().pipe(
    Effect.map((all) => all.filter((record) => _metadataTag(record) === tag).map(_volumeInfo))
  )

// kumulo: caller (core delete flow) never invokes this for retain: true
// volumes — the retention policy is enforced one layer up, not here.
export const deleteVolume = (ref: VolumeRef): R<void> =>
  cinderRequest({ path: `volumes/${ref.id}`, method: "DELETE", ref: ref.id, okStatuses: [404] }).pipe(Effect.asVoid)

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
