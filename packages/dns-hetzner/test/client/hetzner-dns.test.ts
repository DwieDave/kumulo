import { Effect, Option } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeHetznerDnsClient } from "../../src/client/hetzner-dns.ts"

const _fixtureBaseUrl = "https://fixture.invalid"

/**
 * Fixture-replay HttpClient (zero network) — asserts request shape, replays
 * canned Hetzner Cloud API responses. Mirrors dns-ovh's client test harness.
 */
const _rawHttpClient = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

const _fixtureHttpClient = (fixture: { readonly status: number; readonly body: unknown }) =>
  _rawHttpClient(() => new Response(JSON.stringify(fixture.body), { status: fixture.status }))

it.effect("resolves a zone by name (GET /zones/{id_or_name})", () =>
  Effect.gen(function*() {
    const httpClient = _fixtureHttpClient({ status: 200, body: { zone: { id: "42", name: "example.com" } } })
    const client = makeHetznerDnsClient(httpClient)
    const zone = yield* client.getZone("example.com")
    assert.deepStrictEqual(zone, { id: "42", name: "example.com" })
  }))

it.effect("creates-or-replaces a rrset (PUT /zones/{id}/rrsets/{name}/{type})", () =>
  Effect.gen(function*() {
    let capturedPath: string | undefined
    const rrset = { name: "api.example.com", type: "A", ttl: 300, records: [{ value: "10.0.0.1" }] }
    const httpClient = _rawHttpClient((request) => {
      capturedPath = request.url
      return new Response(JSON.stringify({ rrset }), { status: 200 })
    })
    const client = makeHetznerDnsClient(httpClient)
    const result = yield* client.putRRset("example.com", "api.example.com", "A", { ttl: 300, records: [{ value: "10.0.0.1" }] })
    assert.strictEqual(capturedPath, `${_fixtureBaseUrl}/zones/example.com/rrsets/api.example.com/A`)
    assert.deepStrictEqual(result, rrset)
  }))

it.effect("deletes a rrset (DELETE /zones/{id}/rrsets/{name}/{type})", () =>
  Effect.gen(function*() {
    let capturedPath: string | undefined
    const httpClient = _rawHttpClient((request) => {
      capturedPath = request.url
      return new Response(null, { status: 200 })
    })
    const client = makeHetznerDnsClient(httpClient)
    yield* client.deleteRRset("example.com", "api.example.com", "A")
    assert.strictEqual(capturedPath, `${_fixtureBaseUrl}/zones/example.com/rrsets/api.example.com/A`)
  }))

it.effect("lists rrsets across pages (GET /zones/{id}/rrsets)", () =>
  Effect.gen(function*() {
    const pages = [
      { rrsets: [{ name: "a.example.com", type: "A", ttl: 300, records: [{ value: "10.0.0.1" }] }], meta: { pagination: { next_page: 2 } } },
      { rrsets: [{ name: "b.example.com", type: "A", ttl: 300, records: [{ value: "10.0.0.2" }] }], meta: { pagination: { next_page: null } } }
    ]
    const httpClient = _rawHttpClient((request) => {
      // kumulo: query params live in `request.urlParams`, not merged into
      // `request.url`, until `toUrl` combines them (see dns-ovh's fake-zone.ts).
      const url = Option.getOrElse(HttpClientRequest.toUrl(request), () => new URL(request.url))
      const page = Number(url.searchParams.get("page") ?? "1")
      return new Response(JSON.stringify(pages[page - 1]), { status: 200 })
    })
    const client = makeHetznerDnsClient(httpClient)
    const result = yield* client.listRRsets("example.com")
    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[1]?.name, "b.example.com")
  }))

it.effect("surfaces a non-2xx status as a decodable error response", () =>
  Effect.gen(function*() {
    const httpClient = _fixtureHttpClient({ status: 404, body: { error: { message: "zone not found" } } })
    const client = makeHetznerDnsClient(httpClient)
    const failure = yield* Effect.flip(client.getZone("missing.example.com"))
    assert.strictEqual(failure._tag, "HttpClientError")
  }))
