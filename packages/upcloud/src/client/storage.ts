// /1.3/storage envelopes are WRAPPED ({"storage":{...}}), unlike uks.ts's bare shape
import { Effect } from "effect"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { decodeOn2xx, decodeVoid, UpcloudBoolean, UpcloudLabel } from "./common.ts"
import type { UpcloudRawError } from "./common.ts"

export const StorageTier = Schema.Literals(["maxiops", "standard", "hdd"])
export type StorageTier = typeof StorageTier.Type

export const StorageState = Schema.Literals(["online", "maintenance", "cloning", "backuping", "syncing", "error"])
export type StorageState = typeof StorageState.Type

export const Storage = Schema.Struct({
  uuid: Schema.String,
  size: Schema.Number,
  tier: Schema.optionalKey(StorageTier),
  zone: Schema.optionalKey(Schema.String),
  title: Schema.String,
  encrypted: Schema.optionalKey(UpcloudBoolean),
  state: StorageState,
  labels: Schema.optionalKey(Schema.Array(UpcloudLabel))
})
export type Storage = typeof Storage.Type

const _StorageResponse = Schema.Struct({ storage: Storage })
const _StoragesResponse = Schema.Struct({ storages: Schema.Struct({ storage: Schema.Array(Storage) }) })

const _decodeStorage = decodeOn2xx(_StorageResponse)
const _decodeStorages = decodeOn2xx(_StoragesResponse)

export interface StorageCreateInput {
  readonly size: number
  readonly zone: string
  readonly title: string
  readonly tier?: StorageTier
  readonly labels?: ReadonlyArray<UpcloudLabel>
  readonly encrypted?: boolean
}

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
  readonly delete: (uuid: string) => Effect.Effect<void, UpcloudRawError>
}

const _base = "/1.3/storage"

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
