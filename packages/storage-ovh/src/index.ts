export const packageName = "@kumulo/storage-ovh"

export { makeStorageClient } from "./client/storage.ts"
export type { Storage, StorageError } from "./client/storage.ts"

export { makeOvhObjectStorageProvider, ovhObjectStorageProviderLive } from "./provider/object-storage-provider.ts"
export { toStorageError } from "./provider/errors.ts"
