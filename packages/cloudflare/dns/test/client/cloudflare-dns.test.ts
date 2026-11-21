import { Effect, Option, Predicate } from "effect"
import { assert, describe, it } from "@effect/vitest"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { makeCloudflareDnsClient } from "../../src/client/cloudflare-dns.ts"
import { makeFakeZone } from "../provider/fake-zone.ts"

// Responses shaped after the vendored spec: zones-get, dns-records-for-a-zone-list-dns-records, and the failure envelope.
const _scripted = (responses: ReadonlyArray<unknown>, status = 200) => {
  const urls: Array<string> = []

  const httpClient = HttpClient.make((request) =>
    Effect.sync(() => {
      const body = responses[Math.min(urls.length, responses.length - 1)]
      urls.push(request.url)

      return HttpClientResponse.fromWeb(request, Response.json(body, { status }))
    })
  ).pipe(HttpClient.mapRequest((request) => HttpClientRequest.prependUrl(request, "https://fixture.invalid")))

  return { urls, dns: makeCloudflareDnsClient(httpClient) }
}

const _zone = (overrides: { readonly id?: string; readonly name?: string; readonly status?: string }) => ({
  id: "023e105f4ecef8ad9ca31a8372d0c353",
  name: "example.com",
  status: "active",
  name_servers: ["bob.ns.cloudflare.com", "lola.ns.cloudflare.com"],
  original_name_servers: ["ns1.originaldnshost.com"],
  development_mode: 0,
  ...overrides
})

const _envelope = <A>(result: A) => ({ success: true, errors: [], messages: [], result })

const _page = <A>(result: A, resultInfo: { readonly page: number; readonly per_page: number; readonly total_pages: number }) => ({
  ..._envelope(result),
  result_info: resultInfo
})

const _record = (id: string) => ({
  id,
  name: `${id}.example.com`,
  type: "A",
  content: "198.51.100.4",
  ttl: 1,
  proxied: false,
  proxiable: true,
  created_on: "2014-01-01T05:20:00.12345Z",
  modified_on: "2014-01-01T05:20:00.12345Z",
  meta: {}
})

describe("findZone", () => {
  it.effect("filters by name and returns the exact match, preferring an active zone", () =>
    Effect.gen(function*() {
      const { dns, urls } = _scripted([_envelope([
        _zone({ id: "sub", name: "eu.example.com" }),
        _zone({ id: "moved", status: "moved" }),
        _zone({ id: "live", name: "Example.com" })
      ])])

      const found = yield* dns.findZone({ name: "example.com" })
      assert.strictEqual(Option.getOrUndefined(found)?.id, "live")
      assert.deepStrictEqual(Option.getOrUndefined(found)?.name_servers, ["bob.ns.cloudflare.com", "lola.ns.cloudflare.com"])
      assert.strictEqual(urls[0], "https://fixture.invalid/zones?name=example.com&per_page=50")
    }))

  it.effect("is none when the token sees no zone of that name", () =>
    Effect.gen(function*() {
      const { dns } = _scripted([_envelope([])])
      assert.isTrue(Option.isNone(yield* dns.findZone({ name: "example.com" })))
    }))

  it.effect("a 2xx with success false is a decode error, not an empty result", () =>
    Effect.gen(function*() {
      const { dns } = _scripted([{ success: false, errors: [{ code: 1000, message: "x" }], messages: [], result: [] }])
      const error = yield* Effect.flip(dns.findZone({ name: "example.com" }))
      assert.isTrue(Predicate.isTagged(error, "ResponseDecodeError"))
    }))

  it.effect("a 403 maps to AuthenticationFailed", () =>
    Effect.gen(function*() {
      const { dns } = _scripted([{ success: false, errors: [{ code: 10000, message: "Authentication error" }], messages: [], result: null }], 403)
      const error = yield* Effect.flip(dns.findZone({ name: "example.com" }))
      assert.isTrue(Predicate.isTagged(error, "AuthenticationFailed"))
    }))
})

describe("listRecords", () => {
  it.effect("walks page by page until total_pages", () =>
    Effect.gen(function*() {
      const { dns, urls } = _scripted([
        _page([_record("a"), _record("b")], { page: 1, per_page: 2, total_pages: 2 }),
        _page([_record("c")], { page: 2, per_page: 2, total_pages: 2 })
      ])

      const records = yield* dns.listRecords({ zone: "example.com", zoneId: "z1" })
      assert.deepStrictEqual(records.map((r) => r.id), ["a", "b", "c"])
      assert.deepStrictEqual(urls, [
        "https://fixture.invalid/zones/z1/dns_records?per_page=1000&page=1",
        "https://fixture.invalid/zones/z1/dns_records?per_page=1000&page=2"
      ])
    }))

  it.effect("decodes records that carry data instead of content", () =>
    Effect.gen(function*() {
      const srv = { id: "s", name: "_sip._tcp.example.com", type: "SRV", ttl: 3600, data: { port: 8806, priority: 10, target: "x.example.com", weight: 5 } }
      const { dns } = _scripted([_page([srv], { page: 1, per_page: 1000, total_pages: 1 })])
      const records = yield* dns.listRecords({ zone: "example.com", zoneId: "z1" })
      assert.strictEqual(records[0]?.content, undefined)
    }))
})

describe("writes against the fake zone", () => {
  it.effect("create returns the stored record with its id; replace and delete use that id", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com" })
      const input = { type: "A" as const, name: "api.example.com", content: "10.0.0.1", ttl: 600, proxied: false }
      const created = yield* fake.dns.createRecord({ zone: "example.com", zoneId: fake.zoneId, record: input })
      assert.strictEqual(created.content, "10.0.0.1")

      const replaced = yield* fake.dns.replaceRecord({ zone: "example.com", zoneId: fake.zoneId, recordId: created.id, record: { ...input, content: "10.0.0.2" } })
      assert.strictEqual(replaced.id, created.id)
      assert.strictEqual(fake.peek({ name: "api", type: "A" })?.content, "10.0.0.2")

      yield* fake.dns.deleteRecord({ zone: "example.com", zoneId: fake.zoneId, recordId: created.id })
      assert.isUndefined(fake.peek({ name: "api", type: "A" }))
      assert.deepStrictEqual(fake.writes().map((w) => [w.method, w.path]), [
        ["POST", `/zones/${fake.zoneId}/dns_records`],
        ["PUT", `/zones/${fake.zoneId}/dns_records/${created.id}`],
        ["DELETE", `/zones/${fake.zoneId}/dns_records/${created.id}`]
      ])
    }))

  it.effect("deleting a record that is already gone succeeds", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com" })
      yield* fake.dns.deleteRecord({ zone: "example.com", zoneId: fake.zoneId, recordId: "gone" })
    }))

  it.effect("a rejected write surfaces Cloudflare's error code", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com" })

      const error = yield* Effect.flip(fake.dns.createRecord({
        zone: "example.com",
        zoneId: fake.zoneId,
        record: { type: "A", name: "api.example.com", content: "10.0.0.1", ttl: 30 }
      }))

      if (Predicate.isTagged(error, "ProviderApiError")) assert.include(error.operation, "9021")
      else assert.fail("expected ProviderApiError")
    }))
})
