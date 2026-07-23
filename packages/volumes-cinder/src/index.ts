/** @kumulo/volumes-cinder — VolumeProvider implementation (design §3.6, FR-8). */
export const packageName = "@kumulo/volumes-cinder"

export { CinderAuth } from "./auth.ts"

export {
  deleteVolume,
  ensureVolume,
  listClusterVolumes,
  VolumeProviderLive
} from "./provider.ts"
export type { VolumeProviderOptions } from "./provider.ts"

export { staticPvcManifest, staticPvManifest, staticVolumeManifests } from "./manifests.ts"
export type { PvcBinding } from "./manifests.ts"

export {
  decodeOutputs,
  emptyOutputs,
  OutputsFile,
  outputsPath,
  OutputsInvalid,
  OutputsVolume,
  parseOutputsYaml,
  readOutputs,
  removeVolume,
  stringifyOutputsYaml,
  upsertVolume,
  writeOutputs
} from "./outputs.ts"

export { adoptVolume, listVolumes } from "./commands.ts"
export type { AdoptResult } from "./commands.ts"
