import { Effect, Option, Predicate } from "effect"
import * as Schema from "effect/Schema"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as ClientModule from "../../src/client/cloudflare-dns.ts"

// An in-memory Cloudflare zone behind the v4 endpoints the client calls. Shapes follow the vendored
// spec (specs/cloudflare-dns-v4.json): the success/errors/messages envelope, full record names,
// page/per_page with result_info.total_pages. Validation is stricter than Cloudflare where kumulo
// promises something: TXT content must be quoted and TXT must not carry `proxied`.

export interface StoredRecord {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly content: string
  readonly ttl: number
  readonly proxied?: boolean
}

export interface LoggedRequest {
  readonly method: string
  readonly path: string
  readonly search: string
  readonly body: string
}

export interface FakeZoneOptions {
  readonly zone: string
  readonly zoneId?: string
  readonly pageSize?: number
  readonly omitResultInfo?: boolean
  readonly visible?: boolean
  readonly nameServers?: ReadonlyArray<string>
  readonly status?: string
  readonly failWith?: 401 | 403
  readonly rateLimitAfter?: number
  readonly retryAfterSeconds?: number
}

export interface SeedRecord {
  readonly name: string
  readonly type: string
  readonly content: string
  readonly ttl?: number
  readonly proxied?: boolean
}

const _WriteBody = Schema.Struct({
  type: Schema.String,
  name: Schema.String,
  content: Schema.String,
  ttl: Schema.Number,
  proxied: Schema.optionalKey(Schema.Boolean)
})

type WriteBody = typeof _WriteBody.Type

const _decodeWrite = Schema.decodeUnknownOption(Schema.fromJsonString(_WriteBody))

export const fixtureBaseUrl = "https://fixture.invalid"

const _json = ({ body, headers = {}, status }: { readonly status: number; readonly body: unknown; readonly headers?: Record<string, string> }): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })

interface ResultInfo {
  readonly page: number
  readonly per_page: number
  readonly count: number
  readonly total_count: number
  readonly total_pages: number
}

const _ok = <A>(result: A): Response => _json({ status: 200, body: { success: true, errors: [], messages: [], result } })

const _okPage = <A>(result: A, resultInfo: ResultInfo): Response =>
  _json({ status: 200, body: { success: true, errors: [], messages: [], result, result_info: resultInfo } })

const _error = ({ code, message, status }: { readonly status: number; readonly code: number; readonly message: string }): Response =>
  _json({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } })

const _rawBody = (request: HttpClientRequest.HttpClientRequest): string => {
  const body = request.body

  return Predicate.isTagged(body, "Uint8Array") ? new TextDecoder().decode(body.body) : ""
}

const _isAddress = (type: string): boolean => type === "A" || type === "AAAA"

const _isQuoted = (content: string): boolean => content.length >= 2 && content.startsWith("\"") && content.endsWith("\"")

export const makeFakeZone = (options: FakeZoneOptions) => {
  const zoneName = options.zone.toLowerCase()
  const zoneId = options.zoneId ?? "023e105f4ecef8ad9ca31a8372d0c353"
  const records = new Map<string, StoredRecord>()
  const log: Array<LoggedRequest> = []
  const state = { failCreates: 0, nextId: 1, requests: 0, rateLimitAfter: options.rateLimitAfter, visible: options.visible ?? true }
  const base = `/zones/${zoneId}/dns_records`

  const _newId = (): string => `${String(state.nextId++).padStart(32, "0")}`

  const _inZone = (name: string): boolean => name === zoneName || name.endsWith(`.${zoneName}`)

  const _clash = ({ body, id }: { readonly body: WriteBody; readonly id: string | undefined }): boolean =>
    [...records.values()].some((r) =>
      r.id !== id && r.name === body.name.toLowerCase() &&
      ((body.type === "CNAME" && (_isAddress(r.type) || r.type === "CNAME")) || (_isAddress(body.type) && r.type === "CNAME"))
    )

  const _validate = ({ body, id }: { readonly body: WriteBody; readonly id: string | undefined }): Option.Option<Response> => {
    if (!(body.ttl === 1 || (body.ttl >= 60 && body.ttl <= 86400))) {
      return Option.some(_error({ status: 400, code: 9021, message: "Invalid TTL. Must be between 60 and 86400 seconds, or 1 for Automatic." }))
    }

    if (!_inZone(body.name.toLowerCase())) {
      return Option.some(_error({ status: 400, code: 9007, message: "record name must include the zone name" }))
    }

    if (body.type === "TXT" && (body.proxied !== undefined || !_isQuoted(body.content))) {
      return Option.some(_error({ status: 400, code: 9004, message: "TXT content must be quoted and TXT cannot be proxied" }))
    }

    if (_clash({ body, id })) {
      return Option.some(_error({ status: 400, code: 81053, message: "An A, AAAA, or CNAME record with that host already exists." }))
    }

    return Option.none()
  }

  const _store = ({ body, id }: { readonly id: string; readonly body: WriteBody }): StoredRecord => {
    const plain: StoredRecord = { id, name: body.name.toLowerCase(), type: body.type, content: body.content, ttl: body.ttl }
    const stored = body.proxied === undefined ? plain : { ...plain, proxied: body.proxied }
    records.set(id, stored)

    return stored
  }

  const _list = (url: URL): Response => {
    const requested = Number(url.searchParams.get("per_page") ?? 100)
    const size = options.pageSize === undefined ? requested : Math.min(requested, options.pageSize)
    const page = Number(url.searchParams.get("page") ?? 1)
    const all = [...records.values()]
    const totalPages = Math.max(1, Math.ceil(all.length / size))
    const slice = all.slice((page - 1) * size, page * size)
    const resultInfo = { page, per_page: size, count: slice.length, total_count: all.length, total_pages: totalPages }

    return options.omitResultInfo === true ? _ok(slice) : _okPage(slice, resultInfo)
  }

  const _zones = (url: URL): Response => {
    const name = (url.searchParams.get("name") ?? "").toLowerCase()

    const zone = {
      id: zoneId,
      name: zoneName,
      status: options.status ?? "active",
      name_servers: options.nameServers ?? ["felicity.ns.cloudflare.com", "stevie.ns.cloudflare.com"]
    }

    const result = state.visible && name === zoneName ? [zone] : []

    return _okPage(result, { page: 1, per_page: 50, count: result.length, total_count: result.length, total_pages: 1 })
  }

  const _handleRecord = (request: HttpClientRequest.HttpClientRequest, url: URL): Response => {
    const id = decodeURIComponent(url.pathname.slice(base.length + 1))

    if (!records.has(id)) return _error({ status: 404, code: 81044, message: "Record does not exist." })

    if (request.method === "DELETE") {
      records.delete(id)

      return _ok({ id })
    }

    const body = _decodeWrite(_rawBody(request))

    if (request.method !== "PUT" || Option.isNone(body)) return _error({ status: 400, code: 9000, message: "invalid request" })

    return Option.match(_validate({ body: body.value, id }), {
      onSome: (rejected) => rejected,
      onNone: () => _ok(_store({ id, body: body.value }))
    })
  }

  const _handleCreate = (request: HttpClientRequest.HttpClientRequest): Response => {
    const body = _decodeWrite(_rawBody(request))

    if (Option.isNone(body)) return _error({ status: 400, code: 9000, message: "invalid request" })

    if (state.failCreates > 0) {
      state.failCreates -= 1

      return _error({ status: 400, code: 9999, message: "injected create failure" })
    }

    return Option.match(_validate({ body: body.value, id: undefined }), {
      onSome: (rejected) => rejected,
      onNone: () => _ok(_store({ id: _newId(), body: body.value }))
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
        body: { success: false, errors: [{ code: 971, message: "Please wait and consider throttling your request speed" }], messages: [], result: null },
        headers: { "retry-after": String(seconds) }
      })
    }

    if (options.failWith !== undefined) {
      return _error({ status: options.failWith, code: 10000, message: "Authentication error" })
    }

    if (url.pathname === "/zones" && request.method === "GET") return _zones(url)

    if (url.pathname === base && request.method === "GET") return _list(url)

    if (url.pathname === base && request.method === "POST") return _handleCreate(request)

    if (url.pathname.startsWith(`${base}/`)) return _handleRecord(request, url)

    return _error({ status: 404, code: 7003, message: "Could not route to the requested path" })
  }

  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest((request) => URL.canParse(request.url) ? request : HttpClientRequest.prependUrl(request, fixtureBaseUrl))
  )

  const fullName = (name: string): string => {
    const lowered = name.toLowerCase()

    return lowered === "@" || lowered === "" ? zoneName : _inZone(lowered) ? lowered : `${lowered}.${zoneName}`
  }

  const seed = (record: SeedRecord): StoredRecord => {
    const stored: StoredRecord = { id: _newId(), ttl: 1, ...record, name: fullName(record.name) }
    records.set(stored.id, stored)

    return stored
  }

  return {
    zoneId,
    httpClient,
    dns: ClientModule.makeCloudflareDnsClient(httpClient),
    seed,
    fullName,
    peek: (input: { readonly name: string; readonly type: string }): StoredRecord | undefined =>
      [...records.values()].find((r) => r.name === fullName(input.name) && r.type === input.type),
    peekAll: (): ReadonlyArray<StoredRecord> => [...records.values()],
    requests: (): ReadonlyArray<LoggedRequest> => [...log],
    writes: (): ReadonlyArray<LoggedRequest> => log.filter((r) => r.method !== "GET"),
    failNextCreates: (count: number): void => {
      state.failCreates = count
    },
    setVisible: (visible: boolean): void => {
      state.visible = visible
    },
    setRateLimitAfter: (count: number | undefined): void => {
      state.rateLimitAfter = count
      state.requests = 0
    }
  }
}
