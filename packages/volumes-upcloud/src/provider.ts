import { ProviderApiError, VolumeProvider } from "@kumulo/core"
import type { ClusterTag, VolumeInfo, VolumeRef, VolumeSpec } from "@kumulo/core"
import { Effect, Layer } from "effect"
import { ignoreMissing, mapUpcloudError } from "@kumulo/upcloud"
import type { Storage, StorageClient, StorageTier, UpcloudError } from "@kumulo/upcloud"
import { matchesVolumeLabels, hasClusterLabel, volumeLabels } from "./labels.ts"
import { staticPvManifest } from "./manifests.ts"
import { pollUntil } from "./poll.ts"

export type VolumeError = UpcloudError

export interface VolumeProviderOptions {
  readonly tag: ClusterTag
  readonly zone: string
}

type R<A> = Effect.Effect<A, VolumeError>

const _volumeInfo = (storage: Storage): VolumeInfo => ({ id: storage.uuid, name: storage.title })

const _findByLabel = (
  { client, tag, name }: { readonly client: StorageClient; readonly tag: ClusterTag; readonly name: string }
): R<Storage | undefined> =>
  mapUpcloudError({ self: client.list(), ctx: { kind: "storage", ref: name } }).pipe(
    Effect.map((all) => all.find((storage) => matchesVolumeLabels({ labels: storage.labels, tag, name })))
  )

const _awaitOnline = ({ client, uuid }: { readonly client: StorageClient; readonly uuid: string }): R<Storage> =>
  pollUntil({
    check: mapUpcloudError({ self: client.get(uuid), ctx: { kind: "storage", ref: uuid } }),
    isDone: (storage) => storage.state === "online",
    interval: "3 seconds",
    timeout: "5 minutes",
    onTimeout: () =>
      new ProviderApiError({
        operation: `storage ${uuid} online`,
        status: 0,
        body: "timed out waiting for the storage to reach state \"online\""
      })
  })

const _tier = (type: string): StorageTier => (type === "standard" || type === "hdd" ? type : "maxiops")

export const ensureVolume = (
  { client, options, spec }: {
    readonly client: StorageClient
    readonly options: VolumeProviderOptions
    readonly spec: VolumeSpec
  }
): R<VolumeInfo> =>
  Effect.gen(function*() {
    const existing = yield* _findByLabel({ client, tag: options.tag, name: spec.name })
    if (existing !== undefined) {
      const ready = existing.state === "online" ? existing : yield* _awaitOnline({ client, uuid: existing.uuid })
      return _volumeInfo(ready)
    }
    const created = yield* mapUpcloudError({
      self: client.create({
        size: spec.sizeGb,
        zone: options.zone,
        title: spec.name,
        tier: _tier(spec.type),
        labels: volumeLabels({ tag: options.tag, name: spec.name })
      }),
      ctx: { kind: "storage", ref: spec.name }
    })
    const ready = yield* _awaitOnline({ client, uuid: created.uuid })
    return _volumeInfo(ready)
  })

export const listClusterVolumes = (
  { client, tag }: { readonly client: StorageClient; readonly tag: ClusterTag }
): R<ReadonlyArray<VolumeInfo>> =>
  mapUpcloudError({ self: client.list(), ctx: { kind: "storage", ref: tag } }).pipe(
    Effect.map((all) => all.filter((storage) => hasClusterLabel({ labels: storage.labels, tag })).map(_volumeInfo))
  )

// never force-detach: an attached volume's 409 surfaces as ResourceConflict untouched; deleting an already-gone volume succeeds
export const deleteVolume = (
  { client, ref }: { readonly client: StorageClient; readonly ref: VolumeRef }
): R<void> => ignoreMissing(mapUpcloudError({ self: client.delete(ref.id), ctx: { kind: "storage", ref: ref.id } }))

export const VolumeProviderLive = (
  { client, options }: { readonly client: StorageClient; readonly options: VolumeProviderOptions }
): Layer.Layer<VolumeProvider> =>
  Layer.succeed(VolumeProvider, {
    ensureVolume: (spec: VolumeSpec) => ensureVolume({ client, options, spec }),
    listClusterVolumes: (tag: ClusterTag) => listClusterVolumes({ client, tag }),
    deleteVolume: (ref: VolumeRef) => deleteVolume({ client, ref }),
    staticPvManifest: (vol: VolumeInfo, spec: VolumeSpec) => staticPvManifest({ vol, spec })
  })
