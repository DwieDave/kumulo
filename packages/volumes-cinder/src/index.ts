/** @kumulo/volumes-cinder — VolumeProvider implementation. */
export const packageName = "@kumulo/volumes-cinder"

export { CinderAuth } from "./auth.ts"
export type { CinderAuthError } from "./auth.ts"
export type { CinderError } from "./rest.ts"

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
  stringifyOutputs,
  stringifyOutputsYaml,
  upsertVolume,
  writeOutputs
} from "./outputs.ts"

export { adoptVolume, listVolumes } from "./commands.ts"
export type { AdoptResult } from "./commands.ts"
