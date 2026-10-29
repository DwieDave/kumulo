import { Effect, Option, Predicate, Schema } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"

export const fakePullZoneHostnameLimit = 10

interface FakeHostname {
  Id: number
  Value: string
  IsSystemHostname: boolean
  HasCertificate: boolean
  ForceSSL: boolean
}

interface FakePullZone {
  Id: number
  Name: string
  Type: number
  OriginType: number
  OriginUrl: string | null
  AddHostHeader: boolean
  VerifyOriginSSL: boolean
  EnableWebSockets: boolean
  EnableSmartCache: boolean
  EnableHostnameVary: boolean
  DisableCookies: boolean
  Hostnames: Array<FakeHostname>
}

const _Body = Schema.Struct({
  Name: Schema.optional(Schema.String),
  Type: Schema.optional(Schema.Number),
  OriginType: Schema.optional(Schema.Number),
  OriginUrl: Schema.optional(Schema.String),
  AddHostHeader: Schema.optional(Schema.Boolean),
  VerifyOriginSSL: Schema.optional(Schema.Boolean),
  EnableWebSockets: Schema.optional(Schema.Boolean),
  EnableSmartCache: Schema.optional(Schema.Boolean),
  EnableHostnameVary: Schema.optional(Schema.Boolean),
  DisableCookies: Schema.optional(Schema.Boolean),
  Hostname: Schema.optional(Schema.String),
  ForceSSL: Schema.optional(Schema.Boolean)
})

type Body = typeof _Body.Type

const _decodeBody = Schema.decodeUnknownOption(Schema.fromJsonString(_Body))

const _bodyOf = (request: HttpClientRequest.HttpClientRequest): Body =>
  Predicate.isTagged(request.body, "Uint8Array")
    ? Option.getOrElse(_decodeBody(new TextDecoder().decode(request.body.body)), () => ({}))
    : {}

const _json = <A>(status: number, value: A): Response => new Response(JSON.stringify(value), { status })

const _empty = (status: number): Response => new Response(null, { status })

const _apiError = (status: number, errorKey: string, message: string): Response =>
  _json(status, { ErrorKey: errorKey, Field: null, Message: message })

export interface FakePullZoneServer {
  readonly httpClient: HttpClient.HttpClient
  readonly setDnsReady: (hostname: string, ready: boolean) => void
  readonly seed: (name: string) => void
  readonly zones: () => ReadonlyArray<FakePullZone>
  readonly requests: () => ReadonlyArray<string>
}

export const makeFakePullZoneServer = (): FakePullZoneServer => {
  const store = new Map<number, FakePullZone>()
  const dnsReady = new Set<string>()
  const log: Array<string> = []
  let nextId = 1
  let nextHostnameId = 1

  const _byName = (name: string): FakePullZone | undefined => [...store.values()].find((zone) => zone.Name === name)

  const _hostnameOwner = (hostname: string): FakePullZone | undefined =>
    [...store.values()].find((zone) => zone.Hostnames.some((h) => h.Value === hostname))

  const _create = (body: Body): Response => {
    const name = body.Name ?? ""

    if (name === "" || _byName(name) !== undefined) return _apiError(400, "pullzone.name_taken", "The name is already taken")

    const id = nextId++

    const zone: FakePullZone = {
      Id: id,
      Name: name,
      Type: body.Type ?? 0,
      OriginType: body.OriginType ?? 0,
      OriginUrl: body.OriginUrl ?? null,
      AddHostHeader: body.AddHostHeader ?? false,
      VerifyOriginSSL: body.VerifyOriginSSL ?? false,
      EnableWebSockets: body.EnableWebSockets ?? false,
      EnableSmartCache: body.EnableSmartCache ?? false,
      EnableHostnameVary: body.EnableHostnameVary ?? false,
      DisableCookies: body.DisableCookies ?? true,
      Hostnames: [{ Id: nextHostnameId++, Value: `${name}.b-cdn.net`, IsSystemHostname: true, HasCertificate: true, ForceSSL: false }]
    }

    store.set(id, zone)

    return _json(201, zone)
  }

  const _update = (zone: FakePullZone, body: Body): Response => {
    zone.Type = body.Type ?? zone.Type
    zone.OriginType = body.OriginType ?? zone.OriginType
    zone.OriginUrl = body.OriginUrl ?? zone.OriginUrl
    zone.AddHostHeader = body.AddHostHeader ?? zone.AddHostHeader
    zone.VerifyOriginSSL = body.VerifyOriginSSL ?? zone.VerifyOriginSSL
    zone.EnableWebSockets = body.EnableWebSockets ?? zone.EnableWebSockets
    zone.EnableSmartCache = body.EnableSmartCache ?? zone.EnableSmartCache
    zone.EnableHostnameVary = body.EnableHostnameVary ?? zone.EnableHostnameVary
    zone.DisableCookies = body.DisableCookies ?? zone.DisableCookies

    return _json(200, zone)
  }

  const _addHostname = (zone: FakePullZone, hostname: string): Response => {
    if (hostname === "") return _apiError(400, "validation_error", "Hostname is required")

    if (_hostnameOwner(hostname) !== undefined) return _apiError(400, "hostname_already_registered", "The hostname is already registered")

    if (zone.Hostnames.length >= fakePullZoneHostnameLimit) return _apiError(400, "hostname_limit_reached", "Hostname limit reached")

    zone.Hostnames.push({ Id: nextHostnameId++, Value: hostname, IsSystemHostname: false, HasCertificate: false, ForceSSL: false })

    return _empty(204)
  }

  const _removeHostname = (zone: FakePullZone, hostname: string): Response => {
    const found = zone.Hostnames.find((h) => h.Value === hostname)

    if (found === undefined) return _apiError(400, "hostname_not_found", "The hostname does not exist")

    if (found.IsSystemHostname) return _apiError(400, "hostname_system", "System hostnames cannot be removed")

    zone.Hostnames = zone.Hostnames.filter((h) => h !== found)

    return _empty(204)
  }

  const _loadCertificate = (hostname: string): Response => {
    const owner = _hostnameOwner(hostname)
    const found = owner?.Hostnames.find((h) => h.Value === hostname)

    if (found === undefined) return _apiError(404, "hostname_not_found", "The hostname does not exist")

    if (!dnsReady.has(hostname)) return _apiError(400, "pullzone.certificate_validation_failed", "Domain validation failed")

    found.HasCertificate = true

    return _json(200, {})
  }

  const _setForceSSL = (zone: FakePullZone, body: Body): Response => {
    const found = zone.Hostnames.find((h) => h.Value === (body.Hostname ?? ""))

    if (found === undefined) return _apiError(400, "hostname_not_found", "The hostname does not exist")

    if (!found.HasCertificate) return _apiError(400, "hostname_no_certificate", "The hostname has no certificate")

    found.ForceSSL = body.ForceSSL ?? false

    return _empty(204)
  }

  const _handleZone = (request: HttpClientRequest.HttpClientRequest, id: number, action: string | undefined): Response => {
    const zone = store.get(id)

    if (zone === undefined) return _apiError(404, "pullzone.not_found", "Pull zone not found")

    const body = _bodyOf(request)

    if (action === undefined) {
      if (request.method === "GET") return _json(200, zone)

      if (request.method === "POST") return _update(zone, body)

      if (request.method === "DELETE") {
        store.delete(id)

        return _empty(204)
      }
    }

    if (action === "addHostname" && request.method === "POST") return _addHostname(zone, body.Hostname ?? "")

    if (action === "removeHostname" && request.method === "DELETE") return _removeHostname(zone, body.Hostname ?? "")

    if (action === "setForceSSL" && request.method === "POST") return _setForceSSL(zone, body)

    return _empty(405)
  }

  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const url = Option.getOrElse(HttpClientRequest.toUrl(request), () => new URL(request.url))
    log.push(`${request.method} ${url.pathname}`)

    if (url.pathname === "/pullzone" && request.method === "GET") {
      const search = url.searchParams.get("search") ?? ""

      const page = Number(url.searchParams.get("page") ?? "1")
      const perPage = Number(url.searchParams.get("perPage") ?? "1000")
      const matching = [...store.values()].filter((zone) => zone.Name.includes(search))

      return _json(200, matching.slice((page - 1) * perPage, page * perPage))
    }

    if (url.pathname === "/pullzone" && request.method === "POST") return _create(_bodyOf(request))

    if (url.pathname === "/pullzone/checkavailability" && request.method === "POST") {
      return _json(200, { Available: _byName(_bodyOf(request).Name ?? "") === undefined })
    }

    if (url.pathname === "/pullzone/loadFreeCertificate" && request.method === "GET") {
      return _loadCertificate(url.searchParams.get("hostname") ?? "")
    }

    const match = url.pathname.match(/^\/pullzone\/(\d+)(?:\/(\w+))?$/)

    if (match?.[1] !== undefined) return _handleZone(request, Number(match[1]), match[2])

    return _apiError(404, "not_found", "Not found")
  }

  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
  )

  return {
    httpClient,
    setDnsReady: (hostname, ready) => {
      if (ready) dnsReady.add(hostname)
      else dnsReady.delete(hostname)
    },
    seed: (name) => {
      _create({ Name: name })
    },
    zones: () => [...store.values()],
    requests: () => log
  }
}
