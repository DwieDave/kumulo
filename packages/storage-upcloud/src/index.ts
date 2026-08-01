/** @kumulo/storage-upcloud — package barrel. */
export const packageName = "@kumulo/storage-upcloud"

export {
  deleteBucket,
  ensureBucket,
  ensureCredentials,
  listBuckets,
  makeUpcloudObjectStorageProvider,
  upcloudObjectStorageProviderLive
} from "./provider/object-storage-provider.ts"
export type { UpcloudObjectStorageOptions } from "./provider/object-storage-provider.ts"
