import { ResourceConflict, VolumeProvider } from "@kumulo/core"
import type { ClusterTag, VolumeError, VolumeInfo, VolumeRef, VolumeSpec } from "@kumulo/core"
import { Effect, Layer } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { makeHcloudClient, type HcloudClient } from "../client/hcloud.ts"
import { ignoreMissing, mapHcloudError } from "../provider/errors.ts"
import { listAll } from "../provider/paginate.ts"
import { staticPvManifest } from "./manifests.ts"
import { enforceMinimumVolumeSize } from "./sizing.ts"

export interface VolumeProviderOptions {
  readonly tag: ClusterTag
  readonly location: string
}

type Deps = HttpClient.HttpClient
type R<A> = Effect.Effect<A, VolumeError, Deps>

interface VolumeRecord {
  readonly id: number
  readonly name: string
  readonly size: number
}

const _clusterLabel = (options: VolumeProviderOptions): Record<string, string> => ({ "kumulo-cluster": options.tag })
const _labelSelector = (options: VolumeProviderOptions): string => `kumulo-cluster=${options.tag}`

const _volumeInfo = (record: VolumeRecord): VolumeInfo => ({ id: String(record.id), name: record.name })

const _findByName = ({ client, name }: { readonly client: HcloudClient; readonly name: string }): R<VolumeRecord | undefined> =>
  mapHcloudError({ self: client.Volumes.listVolumes({ query: { name } }), ctx: { kind: "volume", ref: name } }).pipe(
    Effect.map((response) => response.volumes[0])
  )

const _createVolume = (
  { client, options, size, spec }: {
    readonly client: HcloudClient
    readonly options: VolumeProviderOptions
    readonly spec: VolumeSpec
    readonly size: number
  }
): R<VolumeInfo> =>
  mapHcloudError({
    self: client.Volumes.createVolume({
      payload: { name: spec.name, size, location: options.location, labels: _clusterLabel(options) }
    }),
    ctx: { kind: "volume", ref: spec.name }
  }).pipe(Effect.map((response) => _volumeInfo(response.volume)))

// enlarge-only — a size decrease fails loudly rather than silently no-opping
const _reconcileSize = (
  { client, existing, size, spec }: {
    readonly client: HcloudClient
    readonly spec: VolumeSpec
    readonly size: number
    readonly existing: VolumeRecord
  }
): R<VolumeInfo> => {
  if (size < existing.size) {
    return Effect.fail(new ResourceConflict({ kind: "volume-shrink", ref: `${spec.name}: ${existing.size}Gi -> ${size}Gi` }))
  }
  if (size === existing.size) return Effect.succeed(_volumeInfo(existing))
  return mapHcloudError({
    self: client["Volume Actions"].resizeVolume({ params: { id: existing.id }, payload: { size } }),
    ctx: { kind: "volume", ref: spec.name }
  }).pipe(
    Effect.tap(() => Effect.logInfo(`volume "${spec.name}" enlarged ${existing.size}Gi -> ${size}Gi (id ${existing.id})`)),
    Effect.as(_volumeInfo(existing))
  )
}

export const ensureVolume = ({ options, spec }: { readonly options: VolumeProviderOptions; readonly spec: VolumeSpec }): R<VolumeInfo> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    const size = enforceMinimumVolumeSize(spec.sizeGb)
    if (size !== spec.sizeGb) {
      yield* Effect.logWarning(`volume "${spec.name}" requested ${spec.sizeGb}Gi rounded up to hcloud's ${size}Gi minimum`)
    }
    const existing = yield* _findByName({ client, name: spec.name })
    if (existing === undefined) return yield* _createVolume({ client, options, spec, size })
    return yield* _reconcileSize({ client, existing, size, spec })
  })

export const listClusterVolumes = ({ options }: { readonly options: VolumeProviderOptions }): R<ReadonlyArray<VolumeInfo>> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    const records = yield* listAll((query) =>
      mapHcloudError({
        self: client.Volumes.listVolumes({ query: { ...query, label_selector: _labelSelector(options) } }),
        ctx: { kind: "volume", ref: options.tag }
      }).pipe(Effect.map((response) => ({ items: response.volumes, meta: response.meta })))
    )
    return records.map(_volumeInfo)
  })

export const deleteVolume = (ref: VolumeRef): R<void> =>
  Effect.gen(function*() {
    const client = yield* makeHcloudClient
    yield* ignoreMissing(
      mapHcloudError({ self: client.Volumes.deleteVolume({ params: { id: Number(ref.id) } }), ctx: { kind: "volume", ref: ref.id } })
    )
  })

export const VolumeProviderLive = (options: VolumeProviderOptions): Layer.Layer<VolumeProvider, never, Deps> =>
  Layer.effect(
    VolumeProvider,
    Effect.gen(function*() {
      const context = yield* Effect.context<Deps>()
      const run = <A>(effect: R<A>) => Effect.provide(effect, context)
      return {
        ensureVolume: (spec: VolumeSpec) => run(ensureVolume({ options, spec })),
        listClusterVolumes: (_tag: ClusterTag) => run(listClusterVolumes({ options })),
        deleteVolume: (ref: VolumeRef) => run(deleteVolume(ref)),
        staticPvManifest: (vol: VolumeInfo, spec: VolumeSpec) => staticPvManifest({ vol, spec })
      }
    })
  )
