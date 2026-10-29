import { Effect, Schema } from "effect"
import { ProviderApiError } from "@kumulo/core"
import type * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { toBunnyError } from "../errors.ts"
import { bunnyRequester } from "./request.ts"
import type { BunnyError } from "../errors.ts"
import { BunnyStorageZoneTier, BunnyStorageZoneType } from "../enums.ts"

const _nullableString = Schema.optionalKey(Schema.NullOr(Schema.String))

export const BunnyStorageZone = Schema.Struct({
  Id: Schema.Number,
  Name: Schema.String,
  Password: _nullableString,
  ReadOnlyPassword: _nullableString,
  Region: Schema.String,
  S3Hostname: _nullableString,
  StorageHostname: _nullableString,
  FilesStored: Schema.Number,
  StorageUsed: Schema.Number,
  ZoneTier: BunnyStorageZoneTier,
  StorageZoneType: BunnyStorageZoneType
})

export type BunnyStorageZone = typeof BunnyStorageZone.Type

export const BunnyStorageRegion = Schema.Struct({
  Code: Schema.NullOr(Schema.String),
  Name: _nullableString,
  Continent: _nullableString,
  Tier: Schema.optionalKey(Schema.Number),
  IsMainRegionSupported: Schema.optionalKey(Schema.Boolean),
  IsS3Supported: Schema.optionalKey(Schema.Boolean),
  Endpoint: _nullableString,
  S3Endpoint: _nullableString
})

export type BunnyStorageRegion = typeof BunnyStorageRegion.Type

const _ZonePage = Schema.Struct({
  Items: Schema.Array(BunnyStorageZone),
  HasMoreItems: Schema.Boolean
})

const _CreateRequest = Schema.Struct({
  Name: Schema.String,
  Region: Schema.String,
  ReplicationRegions: Schema.optional(Schema.Array(Schema.String)),
  ZoneTier: BunnyStorageZoneTier,
  StorageZoneType: BunnyStorageZoneType
})

const _AvailabilityRequest = Schema.Struct({ Name: Schema.String })

const _AvailabilityResponse = Schema.Struct({ Available: Schema.optionalKey(Schema.Boolean) })

const _kind = "storage-zone"

export interface BunnyCreateStorageZoneInput {
  readonly name: string
  readonly region: string
  readonly replicationRegions?: ReadonlyArray<string>
  readonly zoneTier?: BunnyStorageZoneTier
}

export interface BunnyListStorageZonesInput {
  readonly search?: string
  readonly perPage?: number
}

export interface BunnyStorageClient {
  readonly listZones: (input?: BunnyListStorageZonesInput) => Effect.Effect<ReadonlyArray<BunnyStorageZone>, BunnyError>
  readonly getZone: (id: number) => Effect.Effect<BunnyStorageZone, BunnyError>
  readonly createZone: (input: BunnyCreateStorageZoneInput) => Effect.Effect<BunnyStorageZone, BunnyError>
  readonly checkAvailability: (name: string) => Effect.Effect<boolean, BunnyError>
  readonly deleteZone: (id: number) => Effect.Effect<void, BunnyError>
  readonly regions: () => Effect.Effect<ReadonlyArray<BunnyStorageRegion>, BunnyError>
}

const _defaultPerPage = 1000

const _withBody = <A, I>(
  { body, path, schema }: { readonly path: string; readonly schema: Schema.Codec<A, I>; readonly body: A }
) => HttpClientRequest.post(path).pipe(HttpClientRequest.schemaBodyJson(schema)(body), Effect.orDie)

export const makeBunnyStorageClient = (httpClient: HttpClient.HttpClient): BunnyStorageClient => {
  const requester = bunnyRequester({ httpClient })

  const execute = (input: { readonly request: HttpClientRequest.HttpClientRequest; readonly ref: string }) =>
    requester.send({ ...input, kind: _kind })

  const send = <A, I>(
    input: { readonly request: HttpClientRequest.HttpClientRequest; readonly ref: string; readonly schema: Schema.Codec<A, I> }
  ) => requester.json({ ...input, kind: _kind })

  const listPage = (
    { page, perPage, search }: { readonly page: number; readonly perPage: number; readonly search: string | undefined }
  ) => {
    const params = { page: String(page), perPage: String(perPage), includeDeleted: "false" }

    return send({
      ref: "list",
      schema: _ZonePage,
      request: HttpClientRequest.get("/storagezone").pipe(
        HttpClientRequest.setUrlParams(search === undefined ? params : { ...params, search })
      )
    })
  }

  const listFrom = (
    { acc, page, perPage, search }: {
      readonly page: number
      readonly perPage: number
      readonly search: string | undefined
      readonly acc: ReadonlyArray<BunnyStorageZone>
    }
  ): Effect.Effect<ReadonlyArray<BunnyStorageZone>, BunnyError> =>
    Effect.flatMap(listPage({ page, perPage, search }), (result) => {
      const all = [...acc, ...result.Items]

      return result.HasMoreItems ? listFrom({ page: page + 1, perPage, search, acc: all }) : Effect.succeed(all)
    })

  return {
    listZones: (input) => listFrom({ page: 1, perPage: input?.perPage ?? _defaultPerPage, search: input?.search, acc: [] }),
    getZone: (id) => send({ ref: String(id), schema: BunnyStorageZone, request: HttpClientRequest.get(`/storagezone/${id}`) }),
    createZone: (input) =>
      _withBody({
        path: "/storagezone",
        schema: _CreateRequest,
        body: {
          Name: input.name,
          Region: input.region,
          ZoneTier: input.zoneTier ?? "Standard",
          StorageZoneType: "Supported",
          ReplicationRegions: input.replicationRegions
        }
      }).pipe(Effect.flatMap((request) => send({ ref: input.name, schema: BunnyStorageZone, request }))),
    checkAvailability: (name) =>
      _withBody({ path: "/storagezone/checkavailability", schema: _AvailabilityRequest, body: { Name: name } }).pipe(
        Effect.flatMap((request) => execute({ ref: name, request })),
        Effect.flatMap((response) =>
          HttpClientResponse.schemaBodyJson(_AvailabilityResponse)(response).pipe(
            Effect.mapError((cause) => toBunnyError({ cause, kind: _kind, ref: name }))
          )
        ),
        Effect.flatMap(({ Available }) =>
          Available === undefined
            ? Effect.fail(new ProviderApiError({ operation: `${_kind} ${name}`, status: 200, body: "availability response has no Available field" }))
            : Effect.succeed(Available)
        )
      ),
    deleteZone: (id) =>
      execute({
        ref: String(id),
        request: HttpClientRequest.delete(`/storagezone/${id}`).pipe(
          HttpClientRequest.setUrlParams({ deleteLinkedPullZones: "false" })
        )
      }).pipe(Effect.asVoid, Effect.catchTag("ResourceNotFound", () => Effect.void)),
    regions: () =>
      send({
        ref: "regions",
        schema: Schema.Array(BunnyStorageRegion),
        request: HttpClientRequest.get("/storagezone/regions")
      })
  }
}
