import { Effect, Option, Predicate } from "effect"
import * as Schema from "effect/Schema"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as ClientModule from "../../src/client/godaddy-dns.ts"

export interface StoredRecord {
  readonly recordId: string
  readonly name: string
  readonly type: string
  readonly data: string
  readonly ttl: number
  readonly priority?: number
}

export interface LoggedRequest {
  readonly method: string
  readonly path: string
  readonly search: string
  readonly body: string
}

export interface FakeZoneOptions {
  readonly pageSize?: number
  readonly forbiddenCode?: string
  readonly rateLimitAfter?: number
  readonly retryAfterSeconds?: number
  readonly locationOnlyIds?: boolean
  readonly emptyCreateBody?: boolean
  readonly hrefPrefix?: string
  readonly repeatNext?: boolean
}

export interface SeedRecord {
  readonly name: string
  readonly type: string
  readonly data: string
  readonly ttl?: number
  readonly priority?: number
}

const _WriteBody = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  data: Schema.String,
  ttl: Schema.Number,
  priority: Schema.optionalKey(Schema.Number)
})

const _decodeWrite = Schema.decodeUnknownOption(_WriteBody)

const _fixtureBaseUrl = "https://fixture.invalid"

const _json = ({ body, headers = {}, status }: { readonly status: number; readonly body: string; readonly headers?: Record<string, string> }): Response =>
  new Response(body, { status, headers: { "content-type": "application/json", ...headers } })

const _error = ({ code, message, status }: { readonly status: number; readonly code: string; readonly message: string }): Response =>
  _json({ status, body: JSON.stringify({ code, message }) })

const _rawBody = (request: HttpClientRequest.HttpClientRequest): string => {
  const body = request.body

  return Predicate.isTagged(body, "Uint8Array") ? new TextDecoder().decode(body.body) : ""
}

const _isProtected = (type: string): boolean => type === "NS" || type === "SOA"

const _protectedSeeds: ReadonlyArray<SeedRecord> = [
  { name: "@", type: "NS", data: "ns01.domaincontrol.com" },
  { name: "@", type: "NS", data: "ns02.domaincontrol.com" },
  { name: "@", type: "SOA", data: "ns01.domaincontrol.com" },
  { name: "@", type: "MX", data: "mail.example.com", priority: 10 },
  { name: "@", type: "TXT", data: "v=spf1 include:_spf.example.com ~all" }
]

export const makeFakeZone = ({ zone: zoneName, ...options }: FakeZoneOptions & { readonly zone: string }) => {
  const records = new Map<string, StoredRecord>()
  const log: Array<LoggedRequest> = []
  const state = { failCreates: 0, nextId: 1, requests: 0, forbiddenCode: options.forbiddenCode, rateLimitAfter: options.rateLimitAfter }
  const base = `/zones/${zoneName}/dns-records`

  const _newId = (): string => `rec_${String(state.nextId++).padStart(6, "0")}_opaque`

  const _isApex = (name: string): boolean => name === "@" || name === "" || name === zoneName

  const _validate = (body: typeof _WriteBody.Type): Option.Option<Response> => {
    if (_isProtected(body.type)) {
      return Option.some(_error({ status: 409, code: "CONFLICT", message: "NS and SOA records cannot be modified" }))
    }

    if (body.ttl < 600) {
      return Option.some(_error({ status: 400, code: "INVALID_BODY", message: "ttl must be at least 600" }))
    }

    if (body.type === "CNAME" && _isApex(body.name)) {
      return Option.some(_error({ status: 422, code: "UNPROCESSABLE_ENTITY", message: "CNAME not allowed at apex" }))
    }

    return Option.none()
  }

  const _store = ({ body, id }: { readonly id: string; readonly body: typeof _WriteBody.Type }): StoredRecord => {
    const stored: StoredRecord = { recordId: id, name: body.name, type: body.type, data: body.data, ttl: body.ttl }
    const withPriority = body.priority === undefined ? stored : { ...stored, priority: body.priority }
    records.set(id, withPriority)

    return withPriority
  }

  const _list = (url: URL): Response => {
    const requested = Number(url.searchParams.get("pageSize") ?? 100)
    const size = options.pageSize === undefined ? requested : Math.min(requested, options.pageSize)
    const page = Number(url.searchParams.get("page") ?? 1)
    const all = [...records.values()]
    const link = ({ p, rel }: { readonly rel: string; readonly p: number }) => ({ rel, href: `${_fixtureBaseUrl}${options.hrefPrefix ?? ""}${base}?page=${p}&pageSize=${size}` })
    const links = options.repeatNext === true ? [link({ rel: "next", p: page })] : page * size < all.length ? [link({ rel: "self", p: page }), link({ rel: "next", p: page + 1 })] : [link({ rel: "self", p: page })]

    return _json({ status: 200, body: JSON.stringify({ items: all.slice((page - 1) * size, page * size), links }) })
  }

  const _handleRecord = (request: HttpClientRequest.HttpClientRequest, url: URL): Response => {
    const id = decodeURIComponent(url.pathname.slice(base.length + 1))
    const existing = records.get(id)

    if (existing === undefined) {
      return _error({ status: 404, code: "NOT_FOUND", message: "record not found" })
    }

    if (_isProtected(existing.type)) {
      return _error({ status: 409, code: "CONFLICT", message: "NS and SOA records cannot be modified" })
    }

    if (request.method === "DELETE") {
      records.delete(id)

      return new Response(null, { status: 204 })
    }

    const body = _decodeWrite(JSON.parse(_rawBody(request)))

    if (request.method !== "PUT" || Option.isNone(body)) {
      return _error({ status: 400, code: "INVALID_BODY", message: "invalid request" })
    }

    return Option.match(_validate(body.value), {
      onSome: (rejected) => rejected,
      onNone: () => _json({ status: 200, body: JSON.stringify(_store({ id, body: body.value })) })
    })
  }

  const _handleCreate = (request: HttpClientRequest.HttpClientRequest): Response => {
    const body = _decodeWrite(JSON.parse(_rawBody(request)))

    if (Option.isNone(body)) {
      return _error({ status: 400, code: "INVALID_BODY", message: "invalid request" })
    }

    if (state.failCreates > 0) {
      state.failCreates -= 1

      return _error({ status: 422, code: "UNPROCESSABLE_ENTITY", message: "injected create failure" })
    }

    return Option.match(_validate(body.value), {
      onSome: (rejected) => rejected,
      onNone: () => {
        const stored = _store({ id: _newId(), body: body.value })
        const headers = { location: `${_fixtureBaseUrl}${base}/${stored.recordId}` }

        return _json({ status: 201, headers, body: options.locationOnlyIds === true || options.emptyCreateBody === true ? (options.emptyCreateBody === true ? "" : "{}") : JSON.stringify(stored) })
      }
    })
  }

  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const url = Option.getOrElse(HttpClientRequest.toUrl(request), () => new URL(request.url))
    log.push({ method: request.method, path: url.pathname, search: url.search, body: _rawBody(request) })
    state.requests += 1

    if (state.rateLimitAfter !== undefined && state.requests > state.rateLimitAfter) {
      const seconds = options.retryAfterSeconds ?? 1

      return _json({
        status: 429,
        body: JSON.stringify({ code: "TOO_MANY_REQUESTS", message: "rate limited", retryAfterSec: seconds }),
        headers: { "retry-after": String(seconds) }
      })
    }

    if (state.forbiddenCode !== undefined) {
      return _error({ status: 403, code: state.forbiddenCode, message: "forbidden" })
    }

    if (url.pathname === base && request.method === "GET") {
      return _list(url)
    }

    if (url.pathname === base && request.method === "POST") {
      return _handleCreate(request)
    }

    if (url.pathname.startsWith(`${base}/`)) {
      return _handleRecord(request, url)
    }

    return _error({ status: 404, code: "NOT_FOUND", message: "not found" })
  }

  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

  const seed = (record: SeedRecord): StoredRecord => {
    const stored: StoredRecord = { recordId: _newId(), ttl: 3600, ...record }
    records.set(stored.recordId, stored)

    return stored
  }

  return {
    httpClient,
    dns: ClientModule.makeGodaddyDnsClient(httpClient),
    seed,
    seedProtected: (): ReadonlyArray<StoredRecord> => _protectedSeeds.map(seed),
    peek: (input: { readonly name: string; readonly type: string }): StoredRecord | undefined =>
      [...records.values()].find((r) => r.name === input.name && r.type === input.type),
    peekAll: (): ReadonlyArray<StoredRecord> => [...records.values()],
    requests: (): ReadonlyArray<LoggedRequest> => [...log],
    writes: (): ReadonlyArray<LoggedRequest> => log.filter((r) => r.method !== "GET"),
    failNextCreates: (count: number): void => {
      state.failCreates = count
    },
    setForbidden: (code: string | undefined): void => {
      state.forbiddenCode = code
    },
    setRateLimitAfter: (count: number | undefined): void => {
      state.rateLimitAfter = count
      state.requests = 0
    }
  }
}
