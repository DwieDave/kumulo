import { Effect, Option } from "effect"
import { assert, it } from "@effect/vitest"
import { AuthenticationFailed, ProviderApiError, ResourceNotFound } from "@kumulo/core"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { bunnyDnsClient } from "../../src/client/dns.ts"
import { makeFakeBunnyDns } from "../../src/testing/fake-dns.ts"

const _a = { Name: "www", Type: "A", Value: "1.2.3.4", Ttl: 300 } as const

it.effect("findZone matches the domain exactly, ignoring substring hits", () =>
  Effect.gen(function*() {
    const fake = makeFakeBunnyDns()
    fake.seedZone("example.com.evil.io")
    const id = fake.seedZone("example.com")
    const found = yield* fake.dns.findZone({ domain: "example.com" })
    assert.strictEqual(Option.map(found, (zone) => zone.Id).pipe(Option.getOrUndefined), id)
    assert.isTrue(Option.isNone(yield* fake.dns.findZone({ domain: "missing.org" })))
  }))

it.effect("findZone walks every page", () =>
  Effect.gen(function*() {
    const fake = makeFakeBunnyDns({ pageSize: 2 })
    fake.seedZone("a.example.com")
    fake.seedZone("b.example.com")
    fake.seedZone("c.example.com")
    const id = fake.seedZone("example.com")
    const found = yield* fake.dns.findZone({ domain: "example.com" })
    assert.strictEqual(Option.map(found, (zone) => zone.Id).pipe(Option.getOrUndefined), id)
    assert.strictEqual(fake.peekRequests().length, 2)
  }))

it.effect("listRecords returns all pages and decodes types", () =>
  Effect.gen(function*() {
    const fake = makeFakeBunnyDns({ pageSize: 2 })
    const zoneId = fake.seedZone("example.com")

    for (const name of ["a", "b", "c", "d", "e"]) fake.seedRecord({ zoneId, record: { ..._a, Name: name } })

    fake.seedRecord({ zoneId, record: { Name: "t", Type: "TXT", Value: "v", Ttl: 60, Comment: "note" } })
    const listed = yield* fake.dns.listRecords({ zoneId })
    assert.strictEqual(listed.length, 6)
    assert.strictEqual(listed[5]?.Type, "TXT")
    assert.strictEqual(listed[5]?.Comment, "note")
    assert.strictEqual(fake.peekRequests().length, 3)
  }))

it.effect("addRecord PUTs the record and returns the created record", () =>
  Effect.gen(function*() {
    const fake = makeFakeBunnyDns()
    const zoneId = fake.seedZone("example.com")
    const created = yield* fake.dns.addRecord({ zoneId, record: { ..._a, Comment: "kumulo" } })
    assert.strictEqual(created.Type, "A")
    assert.strictEqual(created.Value, "1.2.3.4")
    assert.deepStrictEqual(fake.peekRecords(zoneId).map((record) => record.Id), [created.Id])
    assert.deepStrictEqual(fake.peekWrites(), [{ method: "PUT", path: `/dnszone/${zoneId}/records` }])
  }))

it.effect("addRecord carries PullZoneId for PullZone records", () =>
  Effect.gen(function*() {
    const fake = makeFakeBunnyDns()
    const zoneId = fake.seedZone("example.com")
    const created = yield* fake.dns.addRecord({ zoneId, record: { Name: "", Type: "PullZone", Value: "", Ttl: 300, PullZoneId: 42 } })
    assert.strictEqual(created.Type, "PullZone")
    assert.strictEqual(created.PullZoneId, 42)
  }))

it.effect("updateRecord replaces the record via POST", () =>
  Effect.gen(function*() {
    const fake = makeFakeBunnyDns()
    const zoneId = fake.seedZone("example.com")
    const seeded = fake.seedRecord({ zoneId, record: _a })
    yield* fake.dns.updateRecord({ zoneId, recordId: seeded.Id, record: { ..._a, Value: "5.6.7.8", Ttl: 60 } })
    const stored = fake.peekRecords(zoneId)[0]
    assert.strictEqual(stored?.Id, seeded.Id)
    assert.strictEqual(stored?.Value, "5.6.7.8")
    assert.strictEqual(stored?.Ttl, 60)
    assert.deepStrictEqual(fake.peekWrites(), [{ method: "POST", path: `/dnszone/${zoneId}/records/${seeded.Id}` }])
  }))

it.effect("deleteRecord removes the record", () =>
  Effect.gen(function*() {
    const fake = makeFakeBunnyDns()
    const zoneId = fake.seedZone("example.com")
    const keep = fake.seedRecord({ zoneId, record: { ..._a, Name: "keep" } })
    const drop = fake.seedRecord({ zoneId, record: _a })
    yield* fake.dns.deleteRecord({ zoneId, recordId: drop.Id })
    assert.deepStrictEqual(fake.peekRecords(zoneId).map((record) => record.Id), [keep.Id])
  }))

it.effect("deleting a missing record succeeds and a missing zone maps to ResourceNotFound", () =>
  Effect.gen(function*() {
    const fake = makeFakeBunnyDns()
    const zoneId = fake.seedZone("example.com")
    yield* fake.dns.deleteRecord({ zoneId, recordId: 1 })
    const missingZone = yield* Effect.flip(fake.dns.listRecords({ zoneId: 9 }))
    assert.instanceOf(missingZone, ResourceNotFound)
  }))

const _stub = (status: number, body: string) =>
  bunnyDnsClient({ httpClient: HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, { status })))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
  )})

it.effect("maps 401 and 500 statuses", () =>
  Effect.gen(function*() {
    assert.instanceOf(yield* Effect.flip(_stub(401, "").findZone({ domain: "x.io" })), AuthenticationFailed)
    assert.instanceOf(yield* Effect.flip(_stub(500, "boom").findZone({ domain: "x.io" })), ProviderApiError)
  }))
