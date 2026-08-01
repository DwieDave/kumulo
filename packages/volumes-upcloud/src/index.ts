/** @kumulo/volumes-upcloud — VolumeProvider implementation for UpCloud block storage. */
export const packageName = "@kumulo/volumes-upcloud"

export { CLUSTER_LABEL_KEY, hasClusterLabel, matchesVolumeLabels, VOLUME_LABEL_KEY, volumeLabels } from "./labels.ts"

export {
  deleteVolume,
  ensureVolume,
  listClusterVolumes,
  VolumeProviderLive
} from "./provider.ts"
export type { VolumeError, VolumeProviderOptions } from "./provider.ts"

export { staticPvcManifest, staticPvManifest, staticVolumeManifests, storageClassName } from "./manifests.ts"
export type { PvcBinding } from "./manifests.ts"

export { csiDevicePermissionNote } from "./doctor.ts"
export type { DoctorNote } from "./doctor.ts"

export { pollUntil } from "./poll.ts"
export type { StatusPollOptions } from "./poll.ts"
