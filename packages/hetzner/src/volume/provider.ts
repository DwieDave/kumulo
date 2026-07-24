import { AuthenticationFailed, ResourceConflict, VolumeProvider } from "@kumulo/core"
import type { CloudError, ClusterTag, VolumeError, VolumeInfo, VolumeRef, VolumeSpec } from "@kumulo/core"
import { Effect, Layer } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { decodeListField, decodeSingleField } from "../provider/decode.ts"
import { hcloudRequest, type HcloudRequest } from "../provider/rest.ts"
import { HcloudVolumeRecord } from "../provider/schemas.ts"
import { staticPvManifest } from "./manifests.ts"
import { enforceMinimumVolumeSize } from "./sizing.ts"

export interface VolumeProviderOptions {
  readonly tag: ClusterTag
  readonly location: string
}

type Deps = HttpClient.HttpClient
type R<A> = Effect.Effect<A, VolumeError, Deps>

const _clusterLabel = (options: VolumeProviderOptions): Record<string, string> => ({ "kumulo-cluster": options.tag })
const _labelSelector = (options: VolumeProviderOptions): string => `kumulo-cluster=${options.tag}`

// kumulo: `hcloudRequest`'s declared error channel (`CloudError`) is wider
// than the port's `VolumeError` (adds `CapabilityMissing`/`ProvisioningTimeout`)
// — neither tag is ever actually produced here (this module never polls an
// Action to completion), so this is a total narrow, not a lossy cast.
const _narrowVolumeError = (error: CloudError): VolumeError => {
  if (error._tag === "CapabilityMissing") return new AuthenticationFailed({ hint: error.capability })
  if (error._tag === "ProvisioningTimeout") return new ResourceConflict({ kind: error.kind, ref: error.ref })
  return error
}

const _volumeRequest = (options: HcloudRequest): R<unknown> => hcloudRequest(options).pipe(Effect.mapError(_narrowVolumeError))

const _volumeInfo = (record: HcloudVolumeRecord): VolumeInfo => ({ id: String(record.id), name: record.name })

const _findByName = (options: VolumeProviderOptions, name: string): R<HcloudVolumeRecord | undefined> =>
  _volumeRequest({ path: `volumes?name=${encodeURIComponent(name)}`, method: "GET", kind: "volumes" }).pipe(
    Effect.flatMap(decodeListField({ itemSchema: HcloudVolumeRecord, listField: "volumes", kind: "volumes" })),
    Effect.map((records) => records[0])
  )

const _createVolume = ({ options, size, spec }: { readonly options: VolumeProviderOptions; readonly spec: VolumeSpec; readonly size: number }): R<VolumeInfo> =>
  _volumeRequest({
    path: "volumes",
    method: "POST",
    kind: "volumes",
    body: { name: spec.name, size, location: options.location, labels: _clusterLabel(options) }
  }).pipe(
    Effect.flatMap(decodeSingleField({ itemSchema: HcloudVolumeRecord, field: "volume", kind: "volumes" })),
    Effect.map(_volumeInfo)
  )

// kumulo: enlarge-only healing (R8, N1) — a size increase resizes the
// existing volume in place (hcloud's `resize` action, fire-and-forget: the
// new size is already reflected in the response we don't need, next list
// call sees it); a decrease refuses loudly rather than silently no-opping.
const _reconcileSize = (
  { existing, size, spec }: { readonly spec: VolumeSpec; readonly size: number; readonly existing: HcloudVolumeRecord }
): R<VolumeInfo> => {
  if (size < existing.size) {
    return Effect.fail(new ResourceConflict({ kind: "volume-shrink", ref: `${spec.name}: ${existing.size}Gi -> ${size}Gi` }))
  }
  if (size === existing.size) return Effect.succeed(_volumeInfo(existing))
  return _volumeRequest({ path: `volumes/${existing.id}/actions/resize`, method: "POST", kind: "volumes", body: { size } }).pipe(
    Effect.tap(() => Effect.logInfo(`volume "${spec.name}" enlarged ${existing.size}Gi -> ${size}Gi (id ${existing.id})`)),
    Effect.as(_volumeInfo(existing))
  )
}

export const ensureVolume = ({ options, spec }: { readonly options: VolumeProviderOptions; readonly spec: VolumeSpec }): R<VolumeInfo> =>
  Effect.gen(function*() {
    const size = enforceMinimumVolumeSize(spec.sizeGb)
    if (size !== spec.sizeGb) {
      yield* Effect.logWarning(`volume "${spec.name}" requested ${spec.sizeGb}Gi rounded up to hcloud's ${size}Gi minimum`)
    }
    const existing = yield* _findByName(options, spec.name)
    if (existing === undefined) return yield* _createVolume({ options, spec, size })
    return yield* _reconcileSize({ existing, size, spec })
  })

export const listClusterVolumes = ({ options }: { readonly options: VolumeProviderOptions }): R<ReadonlyArray<VolumeInfo>> =>
  _volumeRequest({ path: `volumes?label_selector=${encodeURIComponent(_labelSelector(options))}`, method: "GET", kind: "volumes" }).pipe(
    Effect.flatMap(decodeListField({ itemSchema: HcloudVolumeRecord, listField: "volumes", kind: "volumes" })),
    Effect.map((records) => records.map(_volumeInfo))
  )

// kumulo: caller (core delete flow) never invokes this for retain: true
// volumes — the retention policy is enforced one layer up, not here (same
// contract `@kumulo/volumes-cinder`'s `deleteVolume` documents).
export const deleteVolume = (ref: VolumeRef): R<void> =>
  _volumeRequest({ path: `volumes/${ref.id}`, method: "DELETE", kind: "volumes", okStatuses: [404] }).pipe(Effect.asVoid)

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
