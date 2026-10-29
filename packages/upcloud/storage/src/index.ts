/** @kumulo/storage-upcloud — package barrel. */
export const packageName = "@kumulo/storage-upcloud"

export {
  deleteBucket,
  ensureBucket,
  ensureCredentials,
  ensureService,
  ensureUserAccess,
  KUMULO_S3_POLICY,
  listBuckets,
  makeUpcloudObjectStorageProvider,
  objectStorageUsername,
  upcloudObjectStorageProviderLive
} from "./provider/object-storage-provider.ts"

export type { UpcloudObjectStorageOptions } from "./provider/object-storage-provider.ts"
