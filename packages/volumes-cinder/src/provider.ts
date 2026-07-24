import { VolumeProvider } from "@kumulo/core"
import type { ClusterTag, VolumeError, VolumeInfo, VolumeRef, VolumeSpec } from "@kumulo/core"
import { Effect, Layer } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { CinderAuth } from "./auth.ts"
import { cinderRequest } from "./rest.ts"
import { decodeVolumeSingle, decodeVolumesList, type VolumeRecord } from "./schemas.ts"
import { staticPvManifest } from "./manifests.ts"

export interface VolumeProviderOptions {
  readonly tag: ClusterTag
}

type Deps = CinderAuth | HttpClient.HttpClient
type R<A> = Effect.Effect<A, VolumeError, Deps>

// kumulo: Cinder volume metadata carries no first-class "cluster" concept —
// this key is our own tagging convention, mirroring the CloudProvider's
// ensure-by-tag+name scheme.
const _tagMetadataKey = "kumulo_cluster"

const _volumeInfo = (record: VolumeRecord): VolumeInfo => ({
  id: record.id ?? "",
  name: record.name ?? ""
})

const _metadataTag = (record: VolumeRecord): string => record.metadata?.kumulo_cluster ?? ""

const _listAll = (): R<ReadonlyArray<VolumeRecord>> =>
  cinderRequest({ path: "volumes/detail", method: "GET", ref: "volumes" }).pipe(Effect.flatMap(decodeVolumesList))

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
