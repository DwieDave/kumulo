/**
 * Hand-written client (D1) over `/1.3/storage` (R1). D3: WRAPPED envelopes —
 * a single storage is `{"storage": {...}}`, a list is
 * `{"storages": {"storage": [...]}}`, and request bodies wrap the same way.
 * Do not model this on `uks.ts` (bare) — transcribed from `upcloud-go-api`'s
 * `storage.go` per D3, not inferred from a sibling client.
 */
import { Effect } from "effect"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { decodeOn2xx, decodeVoid, UpcloudLabel } from "./common.ts"
import type { UpcloudRawError } from "./common.ts"

export const StorageTier = Schema.Literals(["maxiops", "standard", "hdd"])
export type StorageTier = typeof StorageTier.Type

export const StorageState = Schema.Literals(["online", "maintenance", "cloning", "backuping", "syncing", "error"])
export type StorageState = typeof StorageState.Type

export const Storage = Schema.Struct({
  uuid: Schema.String,
  size: Schema.Number,
  // kumulo: absent on non-disk storages — `GET /1.3/storage` lists the whole
  // account, and templates/backups carry no tier (live probe 2026-08-01).
  tier: Schema.optionalKey(StorageTier),
  zone: Schema.String,
  title: Schema.String,
  encrypted: Schema.optionalKey(Schema.Boolean),
  state: StorageState,
  labels: Schema.optionalKey(Schema.Array(UpcloudLabel))
})
export type Storage = typeof Storage.Type

const _StorageResponse = Schema.Struct({ storage: Storage })
const _StoragesResponse = Schema.Struct({ storages: Schema.Struct({ storage: Schema.Array(Storage) }) })

const _decodeStorage = decodeOn2xx(_StorageResponse)
const _decodeStorages = decodeOn2xx(_StoragesResponse)

/** `POST /1.3/storage` body (R1) — `size`/`zone`/`title` required, wrapped as `{"storage": {...}}`. */
export interface StorageCreateInput {
  readonly size: number
  readonly zone: string
  readonly title: string
  readonly tier?: StorageTier
  readonly labels?: ReadonlyArray<UpcloudLabel>
  readonly encrypted?: boolean
}

/** `PUT /1.3/storage/{uuid}` — tier and zone are immutable at the API, so only these are accepted. */
export interface StoragePatchInput {
  readonly title?: string
  readonly size?: number
  readonly labels?: ReadonlyArray<UpcloudLabel>
}

export interface StorageClient {
  readonly list: () => Effect.Effect<ReadonlyArray<Storage>, UpcloudRawError>
  readonly get: (uuid: string) => Effect.Effect<Storage, UpcloudRawError>
  readonly create: (body: StorageCreateInput) => Effect.Effect<Storage, UpcloudRawError>
  readonly modify: (uuid: string, body: StoragePatchInput) => Effect.Effect<Storage, UpcloudRawError>
  /** R1: deletes with `?backups=delete` — kumulo owns no separate backup lifecycle. */
  readonly delete: (uuid: string) => Effect.Effect<void, UpcloudRawError>
}

const _base = "/1.3/storage"

/** Hand-written client (D1) over `/1.3/storage*`. */
export const makeStorageClient = (httpClient: HttpClient.HttpClient): StorageClient => ({
  list: () => httpClient.execute(HttpClientRequest.get(_base)).pipe(Effect.flatMap(_decodeStorages), Effect.map((r) => r.storages.storage)),
  get: (uuid) =>
    httpClient.execute(HttpClientRequest.get(`${_base}/${uuid}`)).pipe(Effect.flatMap(_decodeStorage), Effect.map((r) => r.storage)),
  create: (body) =>
    httpClient.execute(HttpClientRequest.post(_base).pipe(HttpClientRequest.bodyJsonUnsafe({ storage: body }))).pipe(
      Effect.flatMap(_decodeStorage),
      Effect.map((r) => r.storage)
    ),
  modify: (uuid, body) =>
    httpClient.execute(HttpClientRequest.put(`${_base}/${uuid}`).pipe(HttpClientRequest.bodyJsonUnsafe({ storage: body }))).pipe(
      Effect.flatMap(_decodeStorage),
      Effect.map((r) => r.storage)
    ),
  delete: (uuid) =>
    httpClient.execute(HttpClientRequest.delete(`${_base}/${uuid}?backups=delete`)).pipe(Effect.flatMap(decodeVoid))
})
