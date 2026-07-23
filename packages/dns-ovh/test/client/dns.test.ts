import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeDnsClient } from "../../src/client/dns.ts"

const _fixtureBaseUrl = "https://fixture.invalid"

/**
 * Fixture-replay HttpClient (zero network) — asserts request shape, replays
 * canned OVH v1 responses. `prependUrl` gives the generated client's relative
 * request paths an absolute origin, same as `ovhHttpClientLayer` does at the
 * real composition root (provider-ovh).
 */
const _rawHttpClient = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

const _fixtureHttpClient = (fixture: { readonly status: number; readonly body: unknown }) =>
  _rawHttpClient(() => new Response(JSON.stringify(fixture.body), { status: fixture.status }))

it.effect("lists record ids (GET /domain/zone/{zoneName}/record)", () =>
  Effect.gen(function* () {
    const httpClient = _fixtureHttpClient({ status: 200, body: [111, 222] })
    const client = makeDnsClient(httpClient)
    const result = yield* client.getRecords("example.com", undefined)
    assert.deepStrictEqual(result, [111, 222])
  }))

it.effect("creates a record (POST /record) against the target path", () =>
  Effect.gen(function* () {
    const record = { id: 42, zone: "example.com", fieldType: "TXT", subDomain: "kumulo-owner", target: "\"kumulo\"", ttl: 60 }
    let capturedPath: string | undefined
    const httpClient = _rawHttpClient((request) => {
      capturedPath = request.url
      return new Response(JSON.stringify(record), { status: 200 })
    })
    const client = makeDnsClient(httpClient)
    const result = yield* client.createRecord("example.com", {
      payload: { fieldType: "TXT", subDomain: "kumulo-owner", target: "\"kumulo\"" }
    })
    assert.strictEqual(capturedPath, `${_fixtureBaseUrl}/domain/zone/example.com/record`)
    assert.strictEqual(result.target, "\"kumulo\"")
  }))

it.effect("refreshes a zone (POST /refresh, void response)", () =>
  Effect.gen(function* () {
    let capturedPath: string | undefined
    const httpClient = _rawHttpClient((request) => {
      capturedPath = request.url
      return new Response(null, { status: 200 })
    })
    const client = makeDnsClient(httpClient)
    yield* client.refreshZone("example.com", undefined)
    assert.strictEqual(capturedPath, `${_fixtureBaseUrl}/domain/zone/example.com/refresh`)
  }))

it.effect("surfaces a non-2xx status as a decodable error response", () =>
  Effect.gen(function* () {
    const httpClient = _fixtureHttpClient({ status: 404, body: { message: "record not found" } })
    const client = makeDnsClient(httpClient)
    const failure = yield* Effect.flip(client.getRecord("example.com", "999", undefined))
    assert.strictEqual(failure._tag, "HttpClientError")
  }))
