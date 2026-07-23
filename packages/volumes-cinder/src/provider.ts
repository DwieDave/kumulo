import { VolumeProvider } from "@kumulo/core"
import type { ClusterTag, VolumeError, VolumeInfo, VolumeRef, VolumeSpec } from "@kumulo/core"
import { Effect, Layer } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { CinderAuth } from "./auth.ts"
import { asArray, cinderRequest, field, stringField, isRecord } from "./rest.ts"
import { staticPvManifest } from "./manifests.ts"

export interface VolumeProviderOptions {
  readonly tag: ClusterTag
}

type Deps = CinderAuth | HttpClient.HttpClient
type R<A> = Effect.Effect<A, VolumeError, Deps>

// kumulo: Cinder volume metadata carries no first-class "cluster" concept —
// this key is our own tagging convention, mirroring the CloudProvider's
// name-prefix scheme (design §3.6: ensure-by-tag+name).
const _tagMetadataKey = "kumulo_cluster"

const _volumeInfo = (record: unknown): VolumeInfo => ({
  id: stringField({ value: record, key: "id" }),
  name: stringField({ value: record, key: "name" })
})

const _metadataTag = (record: unknown): string =>
  stringField({ value: field({ value: record, key: "metadata" }), key: _tagMetadataKey })

const _listAll = (): R<ReadonlyArray<Record<string, unknown>>> =>
  cinderRequest({ path: "volumes/detail", method: "GET", ref: "volumes" }).pipe(
    Effect.map((body) => asArray(field({ value: body, key: "volumes" })).filter(isRecord))
  )

export const ensureVolume = (
  { options, spec }: { readonly options: VolumeProviderOptions; readonly spec: VolumeSpec }
): R<VolumeInfo> =>
  Effect.gen(function*() {
    const all = yield* _listAll()
    const existing = all.find((record) =>
      stringField({ value: record, key: "name" }) === spec.name && _metadataTag(record) === options.tag
    )
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
    })
    return _volumeInfo(field({ value: created, key: "volume" }))
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
