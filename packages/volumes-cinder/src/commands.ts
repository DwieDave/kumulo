import type { K8sManifest, VolumeSpec } from "@kumulo/core"
import type { OutputsFile, OutputsVolume } from "./outputs.ts"
import { upsertVolume } from "./outputs.ts"
import type { PvcBinding } from "./manifests.ts"
import { staticVolumeManifests } from "./manifests.ts"

export const listVolumes = (file: OutputsFile): ReadonlyArray<OutputsVolume> => file.volumes

export interface AdoptResult {
  readonly outputs: OutputsFile
  readonly manifests: ReadonlyArray<K8sManifest>
}

// no Cinder call needed, re-binds an existing volume id into a new cluster's generated PVs
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
