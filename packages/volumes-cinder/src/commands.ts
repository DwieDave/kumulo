import type { K8sManifest, VolumeSpec } from "@kumulo/core"
import type { OutputsFile, OutputsVolume } from "./outputs.ts"
import { upsertVolume } from "./outputs.ts"
import type { PvcBinding } from "./manifests.ts"
import { staticVolumeManifests } from "./manifests.ts"

// FR-8.3 — `kumulo volumes list`: pure projection of the outputs file (CLI
// wiring/rendering lands in T10.1).
export const listVolumes = (file: OutputsFile): ReadonlyArray<OutputsVolume> => file.volumes

export interface AdoptResult {
  readonly outputs: OutputsFile
  readonly manifests: ReadonlyArray<K8sManifest>
}

// FR-8.3 — `kumulo volumes adopt`: re-binds an existing volume ID into a
// new cluster's generated PVs by recording it in that cluster's outputs
// file and regenerating the static PV(+PVC) manifests against the pinned
// `csi.volumeHandle` — no Cinder call needed, the volume already exists.
export const adoptVolume = (
  { file, volumeId, spec, pvc }: {
    readonly file: OutputsFile
    readonly volumeId: string
    readonly spec: VolumeSpec
    readonly pvc?: PvcBinding
  }
): AdoptResult => {
  const vol = { id: volumeId, name: spec.name }
  const outputs = upsertVolume({ file, volume: { name: spec.name, id: volumeId, retain: spec.retain } })
  const manifests = staticVolumeManifests({ vol, spec, pvc })
  return { outputs, manifests }
}
