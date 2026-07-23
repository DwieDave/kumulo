import { Context, Effect } from "effect"
import type {
  AuthenticationFailed,
  QuotaExceeded,
  ResourceConflict,
  ResourceNotFound
} from "../errors/tagged.ts"
import type { ClusterTag, K8sManifest, VolumeInfo, VolumeRef, VolumeSpec } from "../domain/types.ts"

export type VolumeError = ResourceNotFound | ResourceConflict | AuthenticationFailed | QuotaExceeded

// Design §3.6 — retained volumes with stable IDs; `deleteVolume` is never
// called for `retain: true` volumes (that policy lives at the reconciler,
// not here).
export class VolumeProvider extends Context.Service<VolumeProvider, {
  readonly ensureVolume: (spec: VolumeSpec) => Effect.Effect<VolumeInfo, VolumeError>
  readonly listClusterVolumes: (tag: ClusterTag) => Effect.Effect<ReadonlyArray<VolumeInfo>, VolumeError>
  readonly deleteVolume: (ref: VolumeRef) => Effect.Effect<void, VolumeError>
  readonly staticPvManifest: (vol: VolumeInfo, spec: VolumeSpec) => K8sManifest
}>()("@kumulo/core/VolumeProvider") {}
