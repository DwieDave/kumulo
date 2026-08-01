/**
 * Hand-written client (D1) over `/1.3/object-storage-2` (R2). D3: BARE
 * shapes — no envelope anywhere, unlike `storage.ts`'s sibling endpoint.
 * `operational_state` is `Schema.String` rather than a closed literal union:
 * the live API has grown states before without notice (see
 * `.docs/workflows/upcloud-uks/memories.md`'s Q8 note on this API's habit of
 * drifting from its own docs) and a closed union would turn an unknown-but-
 * valid state into a hard decode failure instead of a value pollers can still
 * compare against `"running"`.
 */
import { Effect } from "effect"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { decodeOn2xx, decodeVoid, UpcloudLabel } from "./common.ts"
import type { UpcloudRawError } from "./common.ts"

export const ObjectStorageConfiguredStatus = Schema.Literals(["started", "stopped"])
export type ObjectStorageConfiguredStatus = typeof ObjectStorageConfiguredStatus.Type

export const ObjectStorageNetwork = Schema.Struct({
  name: Schema.String,
  type: Schema.Literals(["public", "private"]),
  family: Schema.String,
  uuid: Schema.optionalKey(Schema.String)
})
export type ObjectStorageNetwork = typeof ObjectStorageNetwork.Type

export const ObjectStorageEndpoint = Schema.Struct({
  domain_name: Schema.String,
  type: Schema.String,
  iam_url: Schema.optionalKey(Schema.String),
  sts_url: Schema.optionalKey(Schema.String)
})
export type ObjectStorageEndpoint = typeof ObjectStorageEndpoint.Type

export const ObjectStorageService = Schema.Struct({
  uuid: Schema.String,
  name: Schema.String,
  region: Schema.String,
  configured_status: ObjectStorageConfiguredStatus,
  // kumulo: open string, see file header — the ladder here is documented as
  // setup-network -> setup-service -> setup-dns -> setup-checkup -> running
  // (and delete-network -> delete-service -> delete-dns on the way out).
  operational_state: Schema.String,
  labels: Schema.optionalKey(Schema.Array(UpcloudLabel)),
  networks: Schema.optionalKey(Schema.Array(ObjectStorageNetwork)),
  endpoints: Schema.optionalKey(Schema.Array(ObjectStorageEndpoint))
})
export type ObjectStorageService = typeof ObjectStorageService.Type

export const BucketMetrics = Schema.Struct({
  name: Schema.String,
  total_objects: Schema.Number,
  total_size_bytes: Schema.Number,
  // kumulo: an async delete keeps the bucket in the list with `deleted: true`
  // for one poll (N4) — callers must filter it out (R11).
  deleted: Schema.Boolean
})
export type BucketMetrics = typeof BucketMetrics.Type

export const ObjectStorageUser = Schema.Struct({ username: Schema.String })
export type ObjectStorageUser = typeof ObjectStorageUser.Type

export const AccessKeyStatus = Schema.Literals(["active", "inactive"])
export type AccessKeyStatus = typeof AccessKeyStatus.Type

export const AccessKey = Schema.Struct({
  access_key_id: Schema.String,
  status: AccessKeyStatus,
  // kumulo: present ONLY in the create response (D7) — never on get/list.
  secret_access_key: Schema.optionalKey(Schema.String)
})
export type AccessKey = typeof AccessKey.Type

export const ObjectStorageRegion = Schema.Struct({
  name: Schema.String,
  primary_zone: Schema.String,
  zones: Schema.optionalKey(Schema.Array(Schema.String))
})
export type ObjectStorageRegion = typeof ObjectStorageRegion.Type

const _decodeService = decodeOn2xx(ObjectStorageService)
const _decodeServices = decodeOn2xx(Schema.Array(ObjectStorageService))
const _decodeBucketList = decodeOn2xx(Schema.Array(BucketMetrics))
const _decodeUser = decodeOn2xx(ObjectStorageUser)
const _decodeAccessKey = decodeOn2xx(AccessKey)
const _decodeAccessKeys = decodeOn2xx(Schema.Array(AccessKey))
const _decodeRegions = decodeOn2xx(Schema.Array(ObjectStorageRegion))

/** `POST /object-storage-2` body (D6). */
export interface ObjectStorageServiceCreateInput {
  readonly name: string
  readonly region: string
  readonly configured_status: ObjectStorageConfiguredStatus
  readonly labels?: ReadonlyArray<UpcloudLabel>
  readonly networks?: ReadonlyArray<ObjectStorageNetwork>
}

/** `PATCH /object-storage-2/{uuid}` body. */
export interface ObjectStorageServicePatchInput {
  readonly configured_status?: ObjectStorageConfiguredStatus
  readonly labels?: ReadonlyArray<UpcloudLabel>
}

export interface ObjectStorageClient {
  readonly services: {
    readonly list: () => Effect.Effect<ReadonlyArray<ObjectStorageService>, UpcloudRawError>
    readonly get: (uuid: string) => Effect.Effect<ObjectStorageService, UpcloudRawError>
    readonly create: (body: ObjectStorageServiceCreateInput) => Effect.Effect<ObjectStorageService, UpcloudRawError>
    readonly patch: (uuid: string, body: ObjectStorageServicePatchInput) => Effect.Effect<ObjectStorageService, UpcloudRawError>
    /** R2: `force` maps to `?force=true` — non-empty buckets otherwise refuse deletion (D9). */
    readonly delete: (uuid: string, force?: boolean) => Effect.Effect<void, UpcloudRawError>
  }
  readonly buckets: {
    readonly list: (serviceUuid: string) => Effect.Effect<ReadonlyArray<BucketMetrics>, UpcloudRawError>
    readonly create: (serviceUuid: string, name: string) => Effect.Effect<void, UpcloudRawError>
    readonly delete: (serviceUuid: string, name: string) => Effect.Effect<void, UpcloudRawError>
  }
  readonly users: {
    readonly create: (serviceUuid: string, username: string) => Effect.Effect<ObjectStorageUser, UpcloudRawError>
    readonly get: (serviceUuid: string, username: string) => Effect.Effect<ObjectStorageUser, UpcloudRawError>
    readonly delete: (serviceUuid: string, username: string) => Effect.Effect<void, UpcloudRawError>
  }
  readonly accessKeys: {
    /** D7: the response's `secret_access_key` is the only time the secret is ever visible again. */
    readonly create: (serviceUuid: string, username: string) => Effect.Effect<AccessKey, UpcloudRawError>
    readonly list: (serviceUuid: string, username: string) => Effect.Effect<ReadonlyArray<AccessKey>, UpcloudRawError>
    readonly patch: (
      serviceUuid: string,
      username: string,
      accessKeyId: string,
      status: AccessKeyStatus
    ) => Effect.Effect<AccessKey, UpcloudRawError>
    readonly delete: (serviceUuid: string, username: string, accessKeyId: string) => Effect.Effect<void, UpcloudRawError>
  }
  readonly regions: () => Effect.Effect<ReadonlyArray<ObjectStorageRegion>, UpcloudRawError>
}

const _base = "/1.3/object-storage-2"
const _service = (uuid: string) => `${_base}/${uuid}`
const _buckets = (serviceUuid: string) => `${_service(serviceUuid)}/buckets`
const _users = (serviceUuid: string) => `${_service(serviceUuid)}/users`
const _user = (serviceUuid: string, username: string) => `${_users(serviceUuid)}/${username}`
const _accessKeys = (serviceUuid: string, username: string) => `${_user(serviceUuid, username)}/access-keys`

/** Hand-written client (D1) over `/object-storage-2*`. */
export const makeObjectStorageClient = (httpClient: HttpClient.HttpClient): ObjectStorageClient => ({
  services: {
    list: () => httpClient.execute(HttpClientRequest.get(_base)).pipe(Effect.flatMap(_decodeServices)),
    get: (uuid) => httpClient.execute(HttpClientRequest.get(_service(uuid))).pipe(Effect.flatMap(_decodeService)),
    create: (body) =>
      httpClient.execute(HttpClientRequest.post(_base).pipe(HttpClientRequest.bodyJsonUnsafe(body))).pipe(Effect.flatMap(_decodeService)),
    patch: (uuid, body) =>
      httpClient.execute(HttpClientRequest.patch(_service(uuid)).pipe(HttpClientRequest.bodyJsonUnsafe(body))).pipe(
        Effect.flatMap(_decodeService)
      ),
    delete: (uuid, force) =>
      httpClient.execute(HttpClientRequest.delete(force ? `${_service(uuid)}?force=true` : _service(uuid))).pipe(
        Effect.flatMap(decodeVoid)
      )
  },
  buckets: {
    list: (serviceUuid) => httpClient.execute(HttpClientRequest.get(_buckets(serviceUuid))).pipe(Effect.flatMap(_decodeBucketList)),
    create: (serviceUuid, name) =>
      httpClient.execute(HttpClientRequest.post(_buckets(serviceUuid)).pipe(HttpClientRequest.bodyJsonUnsafe({ name }))).pipe(
        Effect.flatMap(decodeVoid)
      ),
    delete: (serviceUuid, name) =>
      httpClient.execute(HttpClientRequest.delete(`${_buckets(serviceUuid)}/${name}`)).pipe(Effect.flatMap(decodeVoid))
  },
  users: {
    create: (serviceUuid, username) =>
      httpClient.execute(HttpClientRequest.post(_users(serviceUuid)).pipe(HttpClientRequest.bodyJsonUnsafe({ username }))).pipe(
        Effect.flatMap(_decodeUser)
      ),
    get: (serviceUuid, username) =>
      httpClient.execute(HttpClientRequest.get(_user(serviceUuid, username))).pipe(Effect.flatMap(_decodeUser)),
    delete: (serviceUuid, username) =>
      httpClient.execute(HttpClientRequest.delete(_user(serviceUuid, username))).pipe(Effect.flatMap(decodeVoid))
  },
  accessKeys: {
    // kumulo: create sends an EMPTY body — the API generates the key pair.
    create: (serviceUuid, username) =>
      httpClient.execute(HttpClientRequest.post(_accessKeys(serviceUuid, username))).pipe(Effect.flatMap(_decodeAccessKey)),
    list: (serviceUuid, username) =>
      httpClient.execute(HttpClientRequest.get(_accessKeys(serviceUuid, username))).pipe(Effect.flatMap(_decodeAccessKeys)),
    patch: (serviceUuid, username, accessKeyId, status) =>
      httpClient.execute(
        HttpClientRequest.patch(`${_accessKeys(serviceUuid, username)}/${accessKeyId}`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ status })
        )
      ).pipe(Effect.flatMap(_decodeAccessKey)),
    delete: (serviceUuid, username, accessKeyId) =>
      httpClient.execute(HttpClientRequest.delete(`${_accessKeys(serviceUuid, username)}/${accessKeyId}`)).pipe(
        Effect.flatMap(decodeVoid)
      )
  },
  regions: () => httpClient.execute(HttpClientRequest.get(`${_base}/regions`)).pipe(Effect.flatMap(_decodeRegions))
})
