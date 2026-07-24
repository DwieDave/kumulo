import { Context, Effect } from "effect"
import type {
  AuthenticationFailed,
  BucketNotEmpty,
  HttpTransportError,
  QuotaExceeded,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "../errors/tagged.ts"
import type { BucketInfo, BucketRef, BucketSpec, ClusterTag, S3Credentials } from "../domain/types.ts"

export type ObjectStorageError =
  | ResourceNotFound
  | ResourceConflict
  | AuthenticationFailed
  | QuotaExceeded
  | BucketNotEmpty
  | HttpTransportError
  | ResponseDecodeError

// `deleteBucket` refuses (BucketNotEmpty) when the bucket still holds
// objects; no force_destroy in v1 — that policy lives here, not the caller.
export class ObjectStorageProvider extends Context.Service<ObjectStorageProvider, {
  readonly listBuckets: (region: string) => Effect.Effect<ReadonlyArray<BucketInfo>, ObjectStorageError>
  readonly ensureBucket: (spec: BucketSpec) => Effect.Effect<BucketInfo, ObjectStorageError>
  readonly deleteBucket: (ref: BucketRef) => Effect.Effect<void, ObjectStorageError>
  readonly ensureCredentials: (clusterName: ClusterTag) => Effect.Effect<S3Credentials, ObjectStorageError>
}>()("@kumulo/core/ObjectStorageProvider") {}
