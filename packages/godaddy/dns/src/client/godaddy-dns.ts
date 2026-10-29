import { Effect, Option } from "effect"
import * as Schema from "effect/Schema"
import * as SchemaIssue from "effect/SchemaIssue"
import type { DnsError } from "@kumulo/core"
import type { SchemaError } from "effect/Schema"
import type * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { toDnsError } from "../provider/errors.ts"

export const DnsRecordType = Schema.Literals(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "SOA", "CAA"])

export type DnsRecordType = typeof DnsRecordType.Type

export const DnsRecord = Schema.Struct({
  recordId: Schema.String,
  name: Schema.String,
  type: DnsRecordType,
  data: Schema.String,
  ttl: Schema.Number,
  priority: Schema.optionalKey(Schema.Number),
  service: Schema.optionalKey(Schema.String),
  port: Schema.optionalKey(Schema.Number),
  weight: Schema.optionalKey(Schema.Number),
  protocol: Schema.optionalKey(Schema.String),
  flag: Schema.optionalKey(Schema.Number),
  tag: Schema.optionalKey(Schema.String)
})

export type DnsRecord = typeof DnsRecord.Type

export const DnsRecordInput = Schema.Struct({
  name: Schema.String,
  type: DnsRecordType,
  data: Schema.String,
  ttl: Schema.Number,
  priority: Schema.optionalKey(Schema.Number),
  service: Schema.optionalKey(Schema.String),
  port: Schema.optionalKey(Schema.Number),
  weight: Schema.optionalKey(Schema.Number),
  protocol: Schema.optionalKey(Schema.String),
  flag: Schema.optionalKey(Schema.Number),
  tag: Schema.optionalKey(Schema.String)
})

export type DnsRecordInput = typeof DnsRecordInput.Type

export const DnsRecordList = Schema.Struct({
  items: Schema.Array(DnsRecord),
  links: Schema.optionalKey(Schema.Array(Schema.Struct({ rel: Schema.String, href: Schema.String })))
})

export type DnsRecordList = typeof DnsRecordList.Type

export type GodaddyDnsClientError = DnsError

export interface GodaddyDnsClient {
  readonly listRecords: (input: { readonly zone: string }) => Effect.Effect<ReadonlyArray<DnsRecord>, GodaddyDnsClientError>
  readonly probe: (input: { readonly zone: string }) => Effect.Effect<void, GodaddyDnsClientError>
  readonly createRecord: (input: { readonly zone: string; readonly record: DnsRecordInput }) => Effect.Effect<DnsRecord, GodaddyDnsClientError>
  readonly replaceRecord: (input: {
    readonly zone: string
    readonly recordId: string
    readonly record: DnsRecordInput
  }) => Effect.Effect<DnsRecord, GodaddyDnsClientError>
  readonly deleteRecord: (input: { readonly zone: string; readonly recordId: string }) => Effect.Effect<void, GodaddyDnsClientError>
}

export const clientOperations = [
  { method: "get", path: "/zones/{zone}/dns-records" },
  { method: "post", path: "/zones/{zone}/dns-records" },
  { method: "put", path: "/zones/{zone}/dns-records/{recordId}" },
  { method: "delete", path: "/zones/{zone}/dns-records/{recordId}" }
] as const

export const pageSize = 100

const _recordsPath = (zone: string): string => `/zones/${encodeURIComponent(zone)}/dns-records`

const _recordPath = (input: { readonly zone: string; readonly recordId: string }): string =>
  `${_recordsPath(input.zone)}/${encodeURIComponent(input.recordId)}`

const _mapErrors = (input: { readonly zone: string; readonly name: string }) =>
  <A, R>(effect: Effect.Effect<A, HttpClientError.HttpClientError | SchemaError, R>): Effect.Effect<A, DnsError, R> =>
    Effect.catch(effect, (cause) => Effect.flatMap(toDnsError({ cause, ...input }), Effect.fail))

const _maxPages = 1000

const _schemaFailure = (message: string): SchemaError => new Schema.SchemaError(new SchemaIssue.InvalidValue({ message }))

const _pageSearch = (href: string): string => new URL(href, "https://relative.invalid").search

const _nextHref = (list: DnsRecordList): Option.Option<string> =>
  Option.fromNullishOr(list.links?.find((link) => link.rel === "next")?.href)

const _listFrom = (
  { acc, httpClient, seen, url, zone }: {
    readonly httpClient: HttpClient.HttpClient
    readonly zone: string
    readonly url: string
    readonly acc: ReadonlyArray<DnsRecord>
    readonly seen: ReadonlySet<string>
  }
): Effect.Effect<ReadonlyArray<DnsRecord>, HttpClientError.HttpClientError | SchemaError> =>
  httpClient.execute(HttpClientRequest.get(url)).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) =>
      HttpClientResponse.schemaBodyJson(DnsRecordList)(response).pipe(
        Effect.flatMap((list) => {
          const all = [...acc, ...list.items]

          return Option.match(_nextHref(list), {
            onNone: () => Effect.succeed(all),
            onSome: (href) => {
              const next = `${_recordsPath(zone)}${_pageSearch(href)}`

              return seen.has(next) || seen.size >= _maxPages
                ? Effect.fail(_schemaFailure(`pagination did not terminate at ${next}`))
                : _listFrom({ httpClient, zone, url: next, acc: all, seen: new Set([...seen, next]) })
            }
          })
        })
      )
    )
  )

const _CreatedBody = Schema.Struct({ recordId: Schema.optionalKey(Schema.String) })

const _decodeCreatedBody = Schema.decodeUnknownEffect(Schema.fromJsonString(_CreatedBody))

const _recordIdFromLocation = (response: HttpClientResponse.HttpClientResponse): Option.Option<string> =>
  Option.fromNullishOr(response.headers["location"]).pipe(
    Option.flatMap((location) => Option.fromNullishOr(location.split("?")[0]?.split("/").filter((s) => s !== "").pop())),
    Option.map(decodeURIComponent)
  )

const _decodeCreated = (input: DnsRecordInput) =>
  (response: HttpClientResponse.HttpClientResponse): Effect.Effect<DnsRecord, HttpClientError.HttpClientError | SchemaError> =>
    response.text.pipe(
      Effect.flatMap((text) => text.trim() === "" ? Effect.succeed<typeof _CreatedBody.Type>({}) : _decodeCreatedBody(text)),
      Effect.map((body) => Option.fromNullishOr(body.recordId).pipe(Option.orElse(() => _recordIdFromLocation(response)))),
      Effect.flatMap((recordId) =>
        Option.match(recordId, {
          onNone: () => Effect.fail(new HttpClientError.HttpClientError({
            reason: new HttpClientError.DecodeError({ request: response.request, response, description: "created record has no id in body or Location header" })
          })),
          onSome: (id) => Effect.succeed({ ...input, recordId: id })
        })
      )
    )

const _decodeDeleted = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<void, HttpClientError.HttpClientError> =>
  response.status === 404 ? Effect.void : Effect.asVoid(HttpClientResponse.filterStatusOk(response))

export const makeGodaddyDnsClient = (httpClient: HttpClient.HttpClient): GodaddyDnsClient => ({
  listRecords: ({ zone }) => {
    const first = `${_recordsPath(zone)}?pageSize=${pageSize}`

    return _listFrom({ httpClient, zone, url: first, acc: [], seen: new Set([first]) }).pipe(_mapErrors({ zone, name: "*" }))
  },
  probe: ({ zone }) =>
    httpClient.execute(HttpClientRequest.get(`${_recordsPath(zone)}?pageSize=1`)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.asVoid,
      _mapErrors({ zone, name: "*" })
    ),
  createRecord: ({ zone, record }) =>
    HttpClientRequest.post(_recordsPath(zone)).pipe(
      HttpClientRequest.bodyJson(record),
      Effect.mapError((error) => _schemaFailure(`could not encode the request body: ${error.message}`)),
      Effect.flatMap((request) => httpClient.execute(request)),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(_decodeCreated(record)),
      _mapErrors({ zone, name: record.name })
    ),
  replaceRecord: ({ zone, recordId, record }) =>
    HttpClientRequest.put(_recordPath({ zone, recordId })).pipe(
      HttpClientRequest.bodyJson(record),
      Effect.mapError((error) => _schemaFailure(`could not encode the request body: ${error.message}`)),
      Effect.flatMap((request) => httpClient.execute(request)),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(DnsRecord)),
      _mapErrors({ zone, name: record.name })
    ),
  deleteRecord: (input) =>
    httpClient.execute(HttpClientRequest.delete(_recordPath(input))).pipe(
      Effect.flatMap(_decodeDeleted),
      _mapErrors({ zone: input.zone, name: input.recordId })
    )
})
