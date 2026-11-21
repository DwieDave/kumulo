import { Effect, Option } from "effect"
import * as Schema from "effect/Schema"
import * as SchemaIssue from "effect/SchemaIssue"
import { paginate } from "@kumulo/core"
import type { DnsError } from "@kumulo/core"
import type { SchemaError } from "effect/Schema"
import type * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { toDnsError } from "../errors.ts"

// zones_zone in the spec, cut to what kumulo reads.
export const CloudflareZone = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.optionalKey(Schema.String),
  name_servers: Schema.optionalKey(Schema.Array(Schema.String))
})

export type CloudflareZone = typeof CloudflareZone.Type

// dns-records_dns-record-response. Record types that carry a structured `data` (SRV, CAA, ...)
// may come without `content`; kumulo never manages those, so content stays optional.
export const DnsRecord = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  content: Schema.optionalKey(Schema.String),
  ttl: Schema.optionalKey(Schema.Number),
  proxied: Schema.optionalKey(Schema.Boolean)
})

export type DnsRecord = typeof DnsRecord.Type

export const DnsRecordType = Schema.Literals(["A", "AAAA", "CNAME", "TXT"])

export type DnsRecordType = typeof DnsRecordType.Type

// The body of POST and PUT (dns-records_dns-record-post). `name` is the full record name.
export const DnsRecordInput = Schema.Struct({
  type: DnsRecordType,
  name: Schema.String,
  content: Schema.String,
  ttl: Schema.Number,
  proxied: Schema.optionalKey(Schema.Boolean)
})

export type DnsRecordInput = typeof DnsRecordInput.Type

const _ResultInfo = Schema.Struct({
  page: Schema.optionalKey(Schema.Number),
  total_pages: Schema.optionalKey(Schema.Number)
})

// success: true is part of the decode: a 2xx with success false is not a result.
const ZoneList = Schema.Struct({ success: Schema.Literal(true), result: Schema.Array(CloudflareZone) })

const RecordList = Schema.Struct({
  success: Schema.Literal(true),
  result: Schema.Array(DnsRecord),
  result_info: Schema.optionalKey(_ResultInfo)
})

type RecordList = typeof RecordList.Type

const RecordSingle = Schema.Struct({ success: Schema.Literal(true), result: DnsRecord })

export interface CloudflareDnsClient {
  // The zone with exactly this name that the token can see, preferring an active one.
  readonly findZone: (input: { readonly name: string }) => Effect.Effect<Option.Option<CloudflareZone>, DnsError>
  readonly listRecords: (input: { readonly zone: string; readonly zoneId: string }) => Effect.Effect<ReadonlyArray<DnsRecord>, DnsError>
  readonly createRecord: (input: {
    readonly zone: string
    readonly zoneId: string
    readonly record: DnsRecordInput
  }) => Effect.Effect<DnsRecord, DnsError>
  readonly replaceRecord: (input: {
    readonly zone: string
    readonly zoneId: string
    readonly recordId: string
    readonly record: DnsRecordInput
  }) => Effect.Effect<DnsRecord, DnsError>
  readonly deleteRecord: (input: { readonly zone: string; readonly zoneId: string; readonly recordId: string }) => Effect.Effect<void, DnsError>
}

export const clientOperations = [
  { method: "get", path: "/zones" },
  { method: "get", path: "/zones/{zone_id}/dns_records" },
  { method: "post", path: "/zones/{zone_id}/dns_records" },
  { method: "put", path: "/zones/{zone_id}/dns_records/{dns_record_id}" },
  { method: "delete", path: "/zones/{zone_id}/dns_records/{dns_record_id}" }
] as const

export const pageSize = 1000

const _maxPages = 1000

const _recordsPath = (zoneId: string): string => `/zones/${encodeURIComponent(zoneId)}/dns_records`

const _recordPath = (input: { readonly zoneId: string; readonly recordId: string }): string =>
  `${_recordsPath(input.zoneId)}/${encodeURIComponent(input.recordId)}`

const _mapErrors = (input: { readonly zone: string; readonly name: string }) =>
  <A, R>(effect: Effect.Effect<A, HttpClientError.HttpClientError | SchemaError, R>): Effect.Effect<A, DnsError, R> =>
    Effect.catch(effect, (cause) => Effect.flatMap(toDnsError({ cause, ...input }), Effect.fail))

const _schemaFailure = (message: string): SchemaError => new Schema.SchemaError(new SchemaIssue.InvalidValue({ message }))

// Cloudflare reports total_pages. Without it, only an empty page ends the walk: the server may
// cap per_page below what was asked, so a short page is not proof of the last one.
const _nextPage = ({ cursor, items, page }: { readonly page: RecordList; readonly cursor: number; readonly items: ReadonlyArray<DnsRecord> }) => {
  const total = page.result_info?.total_pages

  if (total !== undefined) return cursor < total ? cursor + 1 : undefined

  return items.length === 0 ? undefined : cursor + 1
}

const _listAll = (
  { httpClient, zoneId }: { readonly httpClient: HttpClient.HttpClient; readonly zoneId: string }
): Effect.Effect<ReadonlyArray<DnsRecord>, HttpClientError.HttpClientError | SchemaError> =>
  paginate({
    initial: 1,
    fetch: (page: number) =>
      httpClient.execute(HttpClientRequest.get(`${_recordsPath(zoneId)}?per_page=${pageSize}&page=${page}`)).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(RecordList))
      ),
    items: (list) => list.result,
    next: _nextPage,
    maxPages: _maxPages
  }).pipe(
    Effect.mapError((error) =>
      error instanceof Schema.SchemaError || HttpClientError.isHttpClientError(error)
        ? error
        : _schemaFailure(`pagination did not terminate: ${error._tag}`)
    )
  )

const _pickZone = (name: string) => (zones: ReadonlyArray<CloudflareZone>): Option.Option<CloudflareZone> => {
  const exact = zones.filter((zone) => zone.name.toLowerCase() === name.toLowerCase())

  return Option.fromNullishOr(exact.find((zone) => zone.status === "active") ?? exact[0])
}

const _write = (
  { httpClient, record, request }: {
    readonly httpClient: HttpClient.HttpClient
    readonly request: HttpClientRequest.HttpClientRequest
    readonly record: DnsRecordInput
  }
): Effect.Effect<DnsRecord, HttpClientError.HttpClientError | SchemaError> =>
  HttpClientRequest.bodyJson(request, record).pipe(
    Effect.mapError((error) => _schemaFailure(`could not encode the request body: ${error.message}`)),
    Effect.flatMap((withBody) => httpClient.execute(withBody)),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(RecordSingle)),
    Effect.map((body) => body.result)
  )

const _decodeDeleted = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<void, HttpClientError.HttpClientError> =>
  response.status === 404 ? Effect.void : Effect.asVoid(HttpClientResponse.filterStatusOk(response))

export const makeCloudflareDnsClient = (httpClient: HttpClient.HttpClient): CloudflareDnsClient => ({
  findZone: ({ name }) =>
    httpClient.execute(HttpClientRequest.get(`/zones?name=${encodeURIComponent(name)}&per_page=50`)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(ZoneList)),
      Effect.map((body) => _pickZone(name)(body.result)),
      _mapErrors({ zone: name, name: "*" })
    ),
  listRecords: ({ zone, zoneId }) => _listAll({ httpClient, zoneId }).pipe(_mapErrors({ zone, name: "*" })),
  createRecord: ({ record, zone, zoneId }) =>
    _write({ httpClient, record, request: HttpClientRequest.post(_recordsPath(zoneId)) }).pipe(
      _mapErrors({ zone, name: record.name })
    ),
  replaceRecord: ({ record, recordId, zone, zoneId }) =>
    _write({ httpClient, record, request: HttpClientRequest.put(_recordPath({ zoneId, recordId })) }).pipe(
      _mapErrors({ zone, name: record.name })
    ),
  deleteRecord: ({ recordId, zone, zoneId }) =>
    httpClient.execute(HttpClientRequest.delete(_recordPath({ zoneId, recordId }))).pipe(
      Effect.flatMap(_decodeDeleted),
      _mapErrors({ zone, name: recordId })
    )
})
