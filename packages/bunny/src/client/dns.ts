import { Effect, Option, Schema } from "effect"
import type * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { toBunnyError } from "../errors.ts"
import { bunnyRequester } from "./request.ts"
import type { BunnyError } from "../errors.ts"
import { BunnyDnsRecordType } from "../enums.ts"

export const BunnyDnsRecord = Schema.Struct({
  Id: Schema.Number,
  Type: BunnyDnsRecordType,
  Ttl: Schema.Number,
  Name: Schema.NullOr(Schema.String),
  Value: Schema.NullOr(Schema.String),
  Comment: Schema.optional(Schema.NullOr(Schema.String)),
  PullZoneId: Schema.optional(Schema.Number),
  AcceleratedPullZoneId: Schema.optional(Schema.Number)
})

export type BunnyDnsRecord = typeof BunnyDnsRecord.Type

export const BunnyDnsZone = Schema.Struct({
  Id: Schema.Number,
  Domain: Schema.NullOr(Schema.String),
  Records: Schema.optional(Schema.NullOr(Schema.Array(BunnyDnsRecord)))
})

export type BunnyDnsZone = typeof BunnyDnsZone.Type

export const BunnyDnsRecordInput = Schema.Struct({
  Name: Schema.String,
  Type: BunnyDnsRecordType,
  Value: Schema.String,
  Ttl: Schema.Number,
  Comment: Schema.optional(Schema.String),
  PullZoneId: Schema.optional(Schema.Number)
})

export type BunnyDnsRecordInput = typeof BunnyDnsRecordInput.Type

const _Page = <S extends Schema.Constraint>(item: S) =>
  Schema.Struct({
    Items: Schema.NullOr(Schema.Array(item)),
    CurrentPage: Schema.Number,
    TotalItems: Schema.Number,
    HasMoreItems: Schema.Boolean
  })

const _ZonePage = _Page(BunnyDnsZone)

const _RecordPage = _Page(BunnyDnsRecord)

const _encodeInput = Schema.encodeEffect(BunnyDnsRecordInput)

const _kind = "DnsZone"

export const bunnyDnsDefaultPageSize = 1000

export interface BunnyDnsClient {
  readonly findZone: (args: { readonly domain: string }) => Effect.Effect<Option.Option<BunnyDnsZone>, BunnyError>
  readonly listRecords: (args: { readonly zoneId: number }) => Effect.Effect<ReadonlyArray<BunnyDnsRecord>, BunnyError>
  readonly addRecord: (
    args: { readonly zoneId: number; readonly record: BunnyDnsRecordInput }
  ) => Effect.Effect<BunnyDnsRecord, BunnyError>
  readonly updateRecord: (
    args: { readonly zoneId: number; readonly recordId: number; readonly record: BunnyDnsRecordInput }
  ) => Effect.Effect<void, BunnyError>
  readonly deleteRecord: (args: { readonly zoneId: number; readonly recordId: number }) => Effect.Effect<void, BunnyError>
}

const _withBody = (
  { record, ref, request }: {
    readonly request: HttpClientRequest.HttpClientRequest
    readonly record: BunnyDnsRecordInput
    readonly ref: string
  }
): Effect.Effect<HttpClientRequest.HttpClientRequest, BunnyError> =>
  _encodeInput(record).pipe(
    Effect.map((body) => HttpClientRequest.bodyJsonUnsafe(request, body)),
    Effect.mapError((cause) => toBunnyError({ cause, kind: _kind, ref }))
  )

export const bunnyDnsClient = (
  { httpClient, pageSize }: { readonly httpClient: HttpClient.HttpClient; readonly pageSize?: number }
): BunnyDnsClient => {
  const perPage = pageSize ?? bunnyDnsDefaultPageSize

  const requester = bunnyRequester({ httpClient })

  const _send = (input: { readonly request: HttpClientRequest.HttpClientRequest; readonly ref: string }) =>
    requester.send({ ...input, kind: _kind })

  const _json = <A, I>(
    input: { readonly request: HttpClientRequest.HttpClientRequest; readonly ref: string; readonly schema: Schema.Codec<A, I> }
  ) => requester.json({ ...input, kind: _kind })

  const _walk = <A, I>(
    { extra, path, ref, schema }: {
      readonly path: string
      readonly ref: string
      readonly schema: Schema.Codec<{ readonly Items: ReadonlyArray<A> | null; readonly HasMoreItems: boolean }, I>
      readonly extra: Readonly<Record<string, string>>
    }
  ): Effect.Effect<ReadonlyArray<A>, BunnyError> => {
    const go = (page: number, acc: ReadonlyArray<A>): Effect.Effect<ReadonlyArray<A>, BunnyError> =>
      _json({
        ref,
        schema,
        request: HttpClientRequest.get(path).pipe(
          HttpClientRequest.setUrlParams({ ...extra, page: String(page), perPage: String(perPage) })
        )
      }).pipe(
        Effect.flatMap((decoded) => {
          const next = [...acc, ...(decoded.Items ?? [])]

          return decoded.HasMoreItems ? go(page + 1, next) : Effect.succeed(next)
        })
      )

    return go(1, [])
  }

  return {
    findZone: ({ domain }) =>
      _walk({ path: "/dnszone", ref: domain, schema: _ZonePage, extra: { search: domain } }).pipe(
        Effect.map((zones) => Option.fromNullishOr(zones.find((zone) => zone.Domain === domain)))
      ),
    listRecords: ({ zoneId }) =>
      _walk({ path: `/dnszone/${zoneId}/records`, ref: String(zoneId), schema: _RecordPage, extra: {} }),
    addRecord: ({ record, zoneId }) => {
      const ref = String(zoneId)

      return _withBody({ request: HttpClientRequest.put(`/dnszone/${zoneId}/records`), record, ref }).pipe(
        Effect.flatMap((request) => _json({ request, ref, schema: BunnyDnsRecord }))
      )
    },
    updateRecord: ({ record, recordId, zoneId }) => {
      const ref = `${zoneId}/${recordId}`

      return _withBody({ request: HttpClientRequest.post(`/dnszone/${zoneId}/records/${recordId}`), record, ref }).pipe(
        Effect.flatMap((request) => _send({ request, ref })),
        Effect.asVoid
      )
    },
    deleteRecord: ({ recordId, zoneId }) =>
      _send({ request: HttpClientRequest.delete(`/dnszone/${zoneId}/records/${recordId}`), ref: `${zoneId}/${recordId}` }).pipe(
        Effect.asVoid,
        Effect.catchTag("ResourceNotFound", () => Effect.void)
      )
  }
}
