import { Effect, Predicate, Schema } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import type * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { assert, it } from "@effect/vitest"
import { makeBunnyPullZoneClient } from "../../src/client/pullzone.ts"
import { fakePullZoneHostnameLimit, makeFakePullZoneServer } from "../../src/testing/fake-pullzone.ts"
import type { BunnyPullZoneSettings } from "../../src/client/pullzone.ts"

const _fake = () => {
  const server = makeFakePullZoneServer()

  return { ...server, client: makeBunnyPullZoneClient(server.httpClient) }
}

const _settings: BunnyPullZoneSettings = {
  type: "Volume",
  originUrl: "https://203.0.113.5",
  addHostHeader: true,
  verifyOriginSSL: false,
  enableWebSockets: true,
  enableSmartCache: true,
  enableHostnameVary: true,
  disableCookies: false
}

it.effect("creates and reads a pull zone with decoded enums and a system hostname", () =>
  Effect.gen(function*() {
    const { client } = _fake()
    const created = yield* client.createPullZone({ name: "acme", settings: _settings })
    assert.strictEqual(created.Type, "Volume")
    assert.strictEqual(created.OriginType, "OriginUrl")
    assert.strictEqual(created.OriginUrl, "https://203.0.113.5")
    assert.strictEqual(created.AddHostHeader, true)
    assert.deepStrictEqual(created.Hostnames.map((h) => [h.Value, h.IsSystemHostname]), [["acme.b-cdn.net", true]])
    const fetched = yield* client.getPullZone({ id: created.Id })
    assert.deepStrictEqual(fetched, created)
  }))

it.effect("findPullZone matches the exact name only", () =>
  Effect.gen(function*() {
    const { client } = _fake()
    yield* client.createPullZone({ name: "acme-staging", settings: _settings })
    assert.strictEqual(yield* client.findPullZone({ name: "acme" }), undefined)
    const exact = yield* client.createPullZone({ name: "acme", settings: _settings })
    assert.strictEqual((yield* client.findPullZone({ name: "acme" }))?.Id, exact.Id)
  }))

it.effect("createPullZone with a taken name fails with ResourceConflict", () =>
  Effect.gen(function*() {
    const { client } = _fake()
    yield* client.createPullZone({ name: "acme", settings: _settings })
    const error = yield* Effect.flip(client.createPullZone({ name: "acme", settings: _settings }))
    assert.strictEqual(error._tag, "ResourceConflict")
  }))

it.effect("updatePullZone writes owned fields", () =>
  Effect.gen(function*() {
    const server = _fake()
    const client = server.client
    const created = yield* client.createPullZone({ name: "acme", settings: _settings })
    const updated = yield* client.updatePullZone({ id: created.Id, settings: { ..._settings, type: "Premium", originUrl: "https://198.51.100.1", enableWebSockets: false } })
    assert.strictEqual(updated.Type, "Premium")
    assert.strictEqual(updated.OriginUrl, "https://198.51.100.1")
    assert.strictEqual(updated.EnableWebSockets, false)
    assert.strictEqual(updated.Hostnames.length, 1)
  }))

const _JsonObject = Schema.Record(Schema.String, Schema.Json)

const _PostedBody = Schema.fromJsonString(_JsonObject)

const _bodyText = (request: HttpClientRequest.HttpClientRequest): string =>
  Predicate.isTagged(request.body, "Uint8Array") ? new TextDecoder().decode(request.body.body) : ""

const _isZoneWrite = (request: HttpClientRequest.HttpClientRequest): boolean =>
  request.method === "POST" && /^\/pullzone\/\d+$/.test(new URL(request.url).pathname)

const _withUnownedFields = (
  { posted, request, response }: {
    readonly request: HttpClientRequest.HttpClientRequest
    readonly response: HttpClientResponse.HttpClientResponse
    readonly posted: Array<string>
  }
) =>
  Effect.gen(function*() {
    if (_isZoneWrite(request)) {
      posted.push(_bodyText(request))

      return response
    }

    if (request.method !== "GET") return response

    const json = yield* HttpClientResponse.schemaBodyJson(_JsonObject)(response)

    return HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify({ ...json, EnableLogging: true, CacheControlMaxAgeOverride: 3600 }), { status: response.status })
    )
  })

it.effect("updatePullZone keeps fields kumulo does not own", () =>
  Effect.gen(function*() {
    const server = makeFakePullZoneServer()
    const posted: Array<string> = []

    const client = makeBunnyPullZoneClient(server.httpClient.pipe(
      HttpClient.transform((effect, request) =>
        Effect.flatMap(effect, (response) => Effect.orDie(_withUnownedFields({ posted, request, response })))
      )
    ))

    const created = yield* client.createPullZone({ name: "acme", settings: _settings })

    yield* client.updatePullZone({ id: created.Id, settings: { ..._settings, originUrl: "https://198.51.100.1" } })

    const body = yield* Schema.decodeEffect(_PostedBody)(posted[0] ?? "")

    assert.strictEqual(body.EnableLogging, true)
    assert.strictEqual(body.CacheControlMaxAgeOverride, 3600)
    assert.strictEqual(body.OriginUrl, "https://198.51.100.1")
  }))

it.effect("updatePullZone on a missing zone fails with ResourceNotFound", () =>
  Effect.gen(function*() {
    const { client } = _fake()
    const error = yield* Effect.flip(client.updatePullZone({ id: 99, settings: _settings }))
    assert.strictEqual(error._tag, "ResourceNotFound")
  }))

it.effect("deletePullZone removes the zone and treats 404 as gone", () =>
  Effect.gen(function*() {
    const server = _fake()
    const created = yield* server.client.createPullZone({ name: "acme", settings: _settings })
    yield* server.client.deletePullZone({ id: created.Id })
    assert.strictEqual(server.zones().length, 0)
    yield* server.client.deletePullZone({ id: created.Id })
  }))

it.effect("adds and removes custom hostnames", () =>
  Effect.gen(function*() {
    const { client } = _fake()
    const zone = yield* client.createPullZone({ name: "acme", settings: _settings })
    yield* client.addHostname({ id: zone.Id, hostname: "www.example.com" })
    const withHost = yield* client.getPullZone({ id: zone.Id })
    const custom = withHost.Hostnames.find((h) => h.Value === "www.example.com")
    assert.deepStrictEqual([custom?.IsSystemHostname, custom?.HasCertificate, custom?.ForceSSL], [false, false, false])
    yield* client.removeHostname({ id: zone.Id, hostname: "www.example.com" })
    assert.strictEqual((yield* client.getPullZone({ id: zone.Id })).Hostnames.length, 1)
  }))

it.effect("rejects a hostname already used by another zone", () =>
  Effect.gen(function*() {
    const { client } = _fake()
    const a = yield* client.createPullZone({ name: "a", settings: _settings })
    const b = yield* client.createPullZone({ name: "b", settings: _settings })
    yield* client.addHostname({ id: a.Id, hostname: "www.example.com" })
    const error = yield* Effect.flip(client.addHostname({ id: b.Id, hostname: "www.example.com" }))
    assert.strictEqual(error._tag, "ProviderApiError")
  }))

it.effect("enforces the hostname limit", () =>
  Effect.gen(function*() {
    const { client } = _fake()
    const zone = yield* client.createPullZone({ name: "acme", settings: _settings })

    for (let i = 1; i < fakePullZoneHostnameLimit; i++) {
      yield* client.addHostname({ id: zone.Id, hostname: `h${i}.example.com` })
    }

    const error = yield* Effect.flip(client.addHostname({ id: zone.Id, hostname: "over.example.com" }))
    assert.strictEqual(error._tag, "ProviderApiError")
  }))

it.effect("removeHostname on an unknown hostname fails", () =>
  Effect.gen(function*() {
    const { client } = _fake()
    const zone = yield* client.createPullZone({ name: "acme", settings: _settings })
    const error = yield* Effect.flip(client.removeHostname({ id: zone.Id, hostname: "nope.example.com" }))
    assert.strictEqual(error._tag, "ProviderApiError")
  }))

it.effect("loadFreeCertificate fails until dns is ready, then setForceSSL works", () =>
  Effect.gen(function*() {
    const server = _fake()
    const { client } = server
    const zone = yield* client.createPullZone({ name: "acme", settings: _settings })
    yield* client.addHostname({ id: zone.Id, hostname: "www.example.com" })
    const early = yield* Effect.flip(client.loadFreeCertificate({ hostname: "www.example.com" }))
    assert.strictEqual(early._tag, "ProviderApiError")
    const premature = yield* Effect.flip(client.setForceSSL({ id: zone.Id, hostname: "www.example.com", forceSSL: true }))
    assert.strictEqual(premature._tag, "ProviderApiError")
    server.setDnsReady("www.example.com", true)
    yield* client.loadFreeCertificate({ hostname: "www.example.com" })
    yield* client.setForceSSL({ id: zone.Id, hostname: "www.example.com", forceSSL: true })
    const host = (yield* client.getPullZone({ id: zone.Id })).Hostnames.find((h) => h.Value === "www.example.com")
    assert.deepStrictEqual([host?.HasCertificate, host?.ForceSSL], [true, true])
  }))

it.effect("loadFreeCertificate for an unknown hostname is ResourceNotFound", () =>
  Effect.gen(function*() {
    const { client } = _fake()
    const error = yield* Effect.flip(client.loadFreeCertificate({ hostname: "ghost.example.com" }))
    assert.strictEqual(error._tag, "ResourceNotFound")
  }))

it.effect("checkAvailability reflects taken names", () =>
  Effect.gen(function*() {
    const { client } = _fake()
    assert.strictEqual(yield* client.checkAvailability({ name: "acme" }), true)
    yield* client.createPullZone({ name: "acme", settings: _settings })
    assert.strictEqual(yield* client.checkAvailability({ name: "acme" }), false)
  }))

it.effect("findPullZone pages through every result before matching the exact name", () =>
  Effect.gen(function*() {
    const { client, requests, seed } = _fake()
    Array.from({ length: 150 }, (_, index) => seed(`acme-${String(index).padStart(3, "0")}`))
    seed("acme")
    const found = yield* client.findPullZone({ name: "acme" })
    assert.strictEqual(found?.Name, "acme")
    assert.isAbove(requests().filter((line) => line === "GET /pullzone").length, 1)
    assert.isUndefined(yield* client.findPullZone({ name: "acme-missing" }))
  }))
