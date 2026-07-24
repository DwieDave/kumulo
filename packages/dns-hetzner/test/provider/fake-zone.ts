import { Effect, Option } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeHetznerDnsClient } from "../../src/client/hetzner-dns.ts"

interface StoredRRset {
  readonly name: string
  readonly type: string
  readonly ttl: number
  readonly records: ReadonlyArray<{ readonly value: string }>
}

const _fixtureBaseUrl = "https://fixture.invalid"

const _bodyOf = (request: HttpClientRequest.HttpClientRequest): { ttl?: number; records?: ReadonlyArray<{ value: string }> } => {
  const body = request.body
  return body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(body.body)) : {}
}

const _key = (name: string, type: string): string => `${name}|${type}`

/**
 * Zero-network in-memory Hetzner Cloud API DNS zone: a mutable rrset store
 * driving the real hand-written client through `HetznerDns`, replaying
 * GET/PUT/DELETE against the store instead of the network. Used both for
 * fixture-replay assertions and as the reusable substrate for the port-contract
 * suite (mirrors dns-ovh's `fake-zone.ts`).
 */
export const makeFakeZone = (zoneName: string) => {
  const rrsets = new Map<string, StoredRRset>()

  const _rrsetPath = `/zones/${zoneName}/rrsets`

  const _handleRRset = (request: HttpClientRequest.HttpClientRequest, name: string, type: string): Response => {
    const key = _key(name, type)
    const existing = rrsets.get(key)
    if (request.method === "GET") {
      return existing ? new Response(JSON.stringify({ rrset: existing }), { status: 200 }) : new Response(null, { status: 404 })
    }
    if (request.method === "PUT") {
      const body = _bodyOf(request)
      const stored: StoredRRset = { name, type, ttl: body.ttl ?? 300, records: body.records ?? [] }
      rrsets.set(key, stored)
      return new Response(JSON.stringify({ rrset: stored }), { status: 200 })
    }
    if (request.method === "DELETE" && existing) {
      rrsets.delete(key)
      return new Response(null, { status: 200 })
    }
    return new Response(null, { status: 404 })
  }

  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const url = Option.getOrElse(HttpClientRequest.toUrl(request), () => new URL(request.url))
    if (request.method === "GET" && url.pathname === `/zones/${zoneName}`) {
      return new Response(JSON.stringify({ zone: { id: "1", name: zoneName } }), { status: 200 })
    }
    if (request.method === "GET" && url.pathname === _rrsetPath) {
      return new Response(JSON.stringify({ rrsets: [...rrsets.values()], meta: { pagination: { next_page: null } } }), { status: 200 })
    }
    const rrsetMatch = url.pathname.match(new RegExp(`^${_rrsetPath}/([^/]+)/([^/]+)$`))
    if (rrsetMatch?.[1] !== undefined && rrsetMatch[2] !== undefined) {
      return _handleRRset(request, decodeURIComponent(rrsetMatch[1]), decodeURIComponent(rrsetMatch[2]))
    }
    return new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 })
  }

  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

  return {
    dns: makeHetznerDnsClient(httpClient),
    /** direct store inspection for assertions, bypassing the client under test */
    peek: (name: string): StoredRRset | undefined =>
      [...rrsets.values()].find((r) => r.name === name && r.type !== "TXT"),
    peekAll: (): ReadonlyArray<StoredRRset> => [...rrsets.values()],
    seed: (rrset: { type: string; name: string; target: string; ttl?: number }): void => {
      rrsets.set(_key(rrset.name, rrset.type), { name: rrset.name, type: rrset.type, ttl: rrset.ttl ?? 300, records: [{ value: rrset.target }] })
    }
  }
}
