/**
 * Thin hand-written client over the Hetzner Cloud API's DNS zone/RRset
 * endpoints (D1 — no confirmed official OpenAPI spec exists to codegen
 * against; mirrors dns-ovh's generated client shape — matchStatus +
 * schemaBodyJson — without the codegen pipeline behind it).
 */
import { Effect } from "effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

export const HetznerRRsetRecord = Schema.Struct({ value: Schema.String })
export type HetznerRRsetRecord = typeof HetznerRRsetRecord.Type

export const HetznerRRset = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  ttl: Schema.Number,
  records: Schema.Array(HetznerRRsetRecord)
})
export type HetznerRRset = typeof HetznerRRset.Type

export const HetznerZone = Schema.Struct({ id: Schema.String, name: Schema.String })
export type HetznerZone = typeof HetznerZone.Type

const _ZoneResponse = Schema.Struct({ zone: HetznerZone })
const _RRsetResponse = Schema.Struct({ rrset: HetznerRRset })
const _RRsetsListResponse = Schema.Struct({
  rrsets: Schema.Array(HetznerRRset),
  meta: Schema.optionalKey(Schema.Struct({
    pagination: Schema.optionalKey(Schema.Struct({ next_page: Schema.NullOr(Schema.Number) }))
  }))
})

export type HetznerDnsError = HttpClientError.HttpClientError | SchemaError

export interface HetznerRRsetInput {
  readonly ttl: number
  readonly records: ReadonlyArray<HetznerRRsetRecord>
}

export interface HetznerDns {
  readonly getZone: (idOrName: string) => Effect.Effect<HetznerZone, HetznerDnsError>
  readonly getRRset: (zoneIdOrName: string, name: string, type: string) => Effect.Effect<HetznerRRset, HetznerDnsError>
  readonly putRRset: (
    zoneIdOrName: string,
    name: string,
    type: string,
    body: HetznerRRsetInput
  ) => Effect.Effect<HetznerRRset, HetznerDnsError>
  readonly deleteRRset: (zoneIdOrName: string, name: string, type: string) => Effect.Effect<void, HetznerDnsError>
  readonly listRRsets: (zoneIdOrName: string) => Effect.Effect<ReadonlyArray<HetznerRRset>, HetznerDnsError>
}

const _unexpectedStatus = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<never, HttpClientError.HttpClientError> =>
  Effect.flatMap(
    Effect.orElseSucceed(response.json, () => "unexpected Hetzner API response status"),
    (description) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.StatusCodeError({
            request: response.request,
            response,
            description: typeof description === "string" ? description : JSON.stringify(description)
          })
        })
      )
  )

// kumulo: plain status-range check instead of `HttpClientResponse.matchStatus` —
// its `Unify`-based case-object inference collapses this file's precise
// per-schema error unions down to `unknown`; a ternary keeps each branch's
// type intact.
const _isOk = (response: HttpClientResponse.HttpClientResponse): boolean => response.status >= 200 && response.status < 300

const _decodeOn2xx = <A, I>(schema: Schema.Codec<A, I>) =>
  (response: HttpClientResponse.HttpClientResponse): Effect.Effect<A, HetznerDnsError> =>
    _isOk(response) ? HttpClientResponse.schemaBodyJson(schema)(response) : _unexpectedStatus(response)

const _decodeZone = _decodeOn2xx(_ZoneResponse)
const _decodeRRset = _decodeOn2xx(_RRsetResponse)
const _decodeRRsetsList = _decodeOn2xx(_RRsetsListResponse)
const _decodeVoid = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<void, HetznerDnsError> =>
  _isOk(response) ? Effect.void : _unexpectedStatus(response)

const _rrsetPath = (zoneIdOrName: string, name: string, type: string): string =>
  `/zones/${encodeURIComponent(zoneIdOrName)}/rrsets/${encodeURIComponent(name)}/${encodeURIComponent(type)}`

const _listPage = (
  httpClient: HttpClient.HttpClient,
  zoneIdOrName: string,
  page: number
): Effect.Effect<{ readonly rrsets: ReadonlyArray<HetznerRRset>; readonly nextPage: number | null }, HetznerDnsError> =>
  httpClient.execute(
    HttpClientRequest.get(`/zones/${encodeURIComponent(zoneIdOrName)}/rrsets`).pipe(
      HttpClientRequest.setUrlParams({ page: String(page), per_page: "50" })
    )
  ).pipe(
    Effect.flatMap(_decodeRRsetsList),
    Effect.map((r) => ({ rrsets: r.rrsets, nextPage: r.meta?.pagination?.next_page ?? null }))
  )

// kumulo: Hetzner Cloud API list endpoints paginate (50/page here) —
// removeClusterRecords's ownership scan needs every rrset in the zone, not
// just the first page, so this walks pages via `meta.pagination.next_page`.
const _listAllRRsets = (
  httpClient: HttpClient.HttpClient,
  zoneIdOrName: string,
  page = 1,
  acc: ReadonlyArray<HetznerRRset> = []
): Effect.Effect<ReadonlyArray<HetznerRRset>, HetznerDnsError> =>
  _listPage(httpClient, zoneIdOrName, page).pipe(
    Effect.flatMap(({ rrsets, nextPage }) =>
      nextPage === null
        ? Effect.succeed([...acc, ...rrsets])
        : _listAllRRsets(httpClient, zoneIdOrName, nextPage, [...acc, ...rrsets])
    )
  )

/** Hand-written client (D1) over `/zones` + `/zones/{id}/rrsets*`. */
export const makeHetznerDnsClient = (httpClient: HttpClient.HttpClient): HetznerDns => ({
  getZone: (idOrName) =>
    httpClient.execute(HttpClientRequest.get(`/zones/${encodeURIComponent(idOrName)}`)).pipe(
      Effect.flatMap(_decodeZone),
      Effect.map((r) => r.zone)
    ),
  getRRset: (zoneIdOrName, name, type) =>
    httpClient.execute(HttpClientRequest.get(_rrsetPath(zoneIdOrName, name, type))).pipe(
      Effect.flatMap(_decodeRRset),
      Effect.map((r) => r.rrset)
    ),
  putRRset: (zoneIdOrName, name, type, body) =>
    httpClient.execute(HttpClientRequest.put(_rrsetPath(zoneIdOrName, name, type)).pipe(HttpClientRequest.bodyJsonUnsafe(body))).pipe(
      Effect.flatMap(_decodeRRset),
      Effect.map((r) => r.rrset)
    ),
  deleteRRset: (zoneIdOrName, name, type) =>
    httpClient.execute(HttpClientRequest.delete(_rrsetPath(zoneIdOrName, name, type))).pipe(Effect.flatMap(_decodeVoid)),
  listRRsets: (zoneIdOrName) => _listAllRRsets(httpClient, zoneIdOrName)
})
