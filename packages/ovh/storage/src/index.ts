export const packageName = "@kumulo/storage-ovh"

export { makeStorageClient } from "./client/storage.ts"

export type { Storage, StorageError } from "./client/storage.ts"

export { makeOvhObjectStorageProvider, ovhObjectStorageProviderLive } from "./provider/object-storage-provider.ts"

export { diffBuckets } from "./diff.ts"

export type { BucketDiff, ExistingBucket } from "./diff.ts"

export { OutputsFile, OutputsInvalid, readOutputs, stringifyOutputsYaml, toOutputsBucket, writeOutputs } from "./outputs.ts"
