export const packageName = "@kumulo/storage-bunny"

export { diffBuckets } from "./diff.ts"

export type { BunnyBucketDiff, BunnyBucketSpec, BunnyTier, ExistingBunnyBucket } from "./diff.ts"

export {
  decodeOutputs,
  emptyOutputs,
  OutputsBucket,
  OutputsFile,
  OutputsInvalid,
  outputsPath,
  parseOutputsYaml,
  readOutputs,
  stringifyOutputs,
  writeOutputs
} from "./outputs.ts"

export { bunnyObjectStorageProviderLive, makeBunnyObjectStorageProvider } from "./provider.ts"

export type { EnsuredZone } from "./provider.ts"
