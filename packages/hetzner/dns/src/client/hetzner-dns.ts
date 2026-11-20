import { Effect, Predicate } from "effect"
import type { SchemaError } from "effect/Schema"
import * as Schema from "effect/Schema"
import type * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { paginate, PaginationLimitExceeded, PaginationStalled, ProviderApiError } from "@kumulo/core"
import type { PaginationError } from "@kumulo/core"

export const HetznerRRsetRecord = Schema.Struct({ value: Schema.String })

export type HetznerRRsetRecord = typeof HetznerRRsetRecord.Type

export const HetznerRRset = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  ttl: Schema.Number,
  records: Schema.Array(HetznerRRsetRecord)
})

export type HetznerRRset = typeof HetznerRRset.Type

const _RRsetResponse = Schema.Struct({ rrset: HetznerRRset })

const _RRsetsListResponse = Schema.Struct({
  rrsets: Schema.Array(HetznerRRset),
  meta: Schema.optionalKey(Schema.Struct({
    pagination: Schema.optionalKey(Schema.Struct({ next_page: Schema.NullOr(Schema.Number) }))
  }))
})

export type HetznerDnsError = HttpClientError.HttpClientError | SchemaError | ProviderApiError

export interface HetznerRRsetInput {
  readonly ttl: number
  readonly records: ReadonlyArray<HetznerRRsetRecord>
}

export interface HetznerDns {
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
            description: Predicate.isString(description) ? description : JSON.stringify(description)
          })
        })
      )
  )

const _isOk = (response: HttpClientResponse.HttpClientResponse): boolean => response.status >= 200 && response.status < 300

const _decodeOn2xx = <A, I>(schema: Schema.Codec<A, I>) =>
  (response: HttpClientResponse.HttpClientResponse): Effect.Effect<A, HetznerDnsError> =>
    _isOk(response) ? HttpClientResponse.schemaBodyJson(schema)(response) : _unexpectedStatus(response)

const _decodeRRset = _decodeOn2xx(_RRsetResponse)
const _decodeRRsetsList = _decodeOn2xx(_RRsetsListResponse)

const _decodeVoid = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<void, HetznerDnsError> =>
  _isOk(response) ? Effect.void : _unexpectedStatus(response)

const _rrsetPath = (zoneIdOrName: string, name: string, type: string): string =>
  `/zones/${encodeURIComponent(zoneIdOrName)}/rrsets/${encodeURIComponent(name)}/${encodeURIComponent(type)}`

const _pagingFailure = (body: string): ProviderApiError => new ProviderApiError({ operation: "hetzner dns list rrsets", status: 0, body })

const _pagingError = (error: HetznerDnsError | PaginationError): HetznerDnsError => {
  if (error instanceof PaginationLimitExceeded) return _pagingFailure(`exceeded ${error.maxPages} pages`)

  if (error instanceof PaginationStalled) return _pagingFailure(`stalled at page ${error.cursor}`)

  return error
}

const _PER_PAGE = 50
const _MAX_PAGES = 1000

const _listPage = (
  httpClient: HttpClient.HttpClient,
  zoneIdOrName: string,
  page: number
): Effect.Effect<{ readonly rrsets: ReadonlyArray<HetznerRRset>; readonly nextPage: number | undefined }, HetznerDnsError> =>
  httpClient.execute(
    HttpClientRequest.get(`/zones/${encodeURIComponent(zoneIdOrName)}/rrsets`).pipe(
      HttpClientRequest.setUrlParams({ page: String(page), per_page: String(_PER_PAGE) })
    )
  ).pipe(
    Effect.flatMap(_decodeRRsetsList),
    Effect.map((r) => ({ rrsets: r.rrsets, nextPage: r.meta?.pagination?.next_page ?? undefined }))
  )

// Hetzner list endpoints paginate 50/page; walks all pages via meta.pagination.next_page.
const _listAllRRsets = (
  httpClient: HttpClient.HttpClient,
  zoneIdOrName: string
): Effect.Effect<ReadonlyArray<HetznerRRset>, HetznerDnsError> =>
  paginate({
    initial: 1,
    fetch: (page) => _listPage(httpClient, zoneIdOrName, page),
    items: (page) => page.rrsets,
    next: ({ page }) => page.nextPage,
    maxPages: _MAX_PAGES
  }).pipe(Effect.mapError(_pagingError))

export const makeHetznerDnsClient = (httpClient: HttpClient.HttpClient): HetznerDns => ({
  putRRset: (zoneIdOrName, name, type, body) =>
    httpClient.execute(HttpClientRequest.put(_rrsetPath(zoneIdOrName, name, type)).pipe(HttpClientRequest.bodyJsonUnsafe(body))).pipe(
      Effect.flatMap(_decodeRRset),
      Effect.map((r) => r.rrset)
    ),
  deleteRRset: (zoneIdOrName, name, type) =>
    httpClient.execute(HttpClientRequest.delete(_rrsetPath(zoneIdOrName, name, type))).pipe(Effect.flatMap(_decodeVoid)),
  listRRsets: (zoneIdOrName) => _listAllRRsets(httpClient, zoneIdOrName)
})
