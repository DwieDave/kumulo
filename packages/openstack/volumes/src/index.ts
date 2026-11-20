/** @kumulo/volumes-cinder — VolumeProvider implementation. */
export const packageName = "@kumulo/volumes-cinder"

export { CinderAuth } from "./auth.ts"

export type { CinderAuthError } from "./auth.ts"

export {
  deleteVolume,
  ensureVolume,
  listClusterVolumes,
  cinderVolumeProviderLive
} from "./provider.ts"

export type { VolumeProviderOptions } from "./provider.ts"

export { staticPvManifest, staticVolumeManifests } from "./manifests.ts"

export {
  decodeOutputs,
  emptyOutputs,
  OutputsFile,
  outputsPath,
  OutputsIngress,
  OutputsInvalid,
  parseOutputsYaml,
  readOutputs,
  setIngress,
  stringifyOutputs,
  stringifyOutputsYaml,
  upsertVolume,
  writeOutputs
} from "./outputs.ts"

export { adoptVolume, listVolumes } from "./commands.ts"
