import { Effect, Redacted } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { assert, it } from "@effect/vitest"
import { ProviderApiError, ResourceConflict, ResourceNotFound, AuthenticationFailed } from "@kumulo/core"
import { makeBunnyStorageClient } from "../../src/client/storage.ts"
import { makeFakeBunnyStorage } from "../../src/testing/fake-storage.ts"
import { makeBunnyHttpClient } from "../../src/transport/http-client.ts"

const _setup = () => {
  const fake = makeFakeBunnyStorage({ apiKey: "k" })
  const http = makeBunnyHttpClient({ base: fake.httpClient, apiKey: Redacted.make("k"), baseUrl: "https://fake.invalid" })

  return { fake, client: makeBunnyStorageClient(http) }
}

it.effect("creates an S3-capable zone with defaults", () =>
  Effect.gen(function*() {
    const { client, fake } = _setup()
    const zone = yield* client.createZone({ name: "kumulo-backups", region: "DE" })
    assert.strictEqual(zone.StorageZoneType, "Supported")
    assert.strictEqual(zone.ZoneTier, "Standard")
    assert.strictEqual(zone.Region, "DE")
    assert.strictEqual(zone.S3Hostname, "de-s3.storage.bunnycdn.com")
    assert.strictEqual(fake.peek().length, 1)
    assert.strictEqual(fake.peek()[0]?.StorageZoneType, 1)
  }))

it.effect("creates an Edge tier zone", () =>
  Effect.gen(function*() {
    const { client } = _setup()
    const zone = yield* client.createZone({ name: "kumulo-edge", region: "NY", zoneTier: "Edge" })
    assert.strictEqual(zone.ZoneTier, "Edge")
  }))

it.effect("rejects duplicate and invalid names", () =>
  Effect.gen(function*() {
    const { client, fake } = _setup()
    fake.seed({ name: "taken-name" })
    const duplicate = yield* Effect.flip(client.createZone({ name: "taken-name", region: "DE" }))
    assert.instanceOf(duplicate, ResourceConflict)

    const invalid = yield* Effect.flip(client.createZone({ name: "x", region: "DE" }))
    assert.instanceOf(invalid, ProviderApiError)
  }))

it.effect("gets a zone and decodes all fields", () =>
  Effect.gen(function*() {
    const { client, fake } = _setup()
    const seeded = fake.seed({ name: "some-zone", region: "SG", filesStored: 3, storageUsed: 99 })
    const zone = yield* client.getZone(seeded.Id)
    assert.strictEqual(zone.Id, seeded.Id)
    assert.strictEqual(zone.Password, seeded.Password)
    assert.strictEqual(zone.ReadOnlyPassword, seeded.ReadOnlyPassword)
    assert.strictEqual(zone.FilesStored, 3)
    assert.strictEqual(zone.StorageUsed, 99)
    assert.strictEqual(zone.StorageHostname, "sg.storage.bunnycdn.com")
  }))

it.effect("maps a missing zone to ResourceNotFound", () =>
  Effect.gen(function*() {
    const { client } = _setup()
    assert.instanceOf(yield* Effect.flip(client.getZone(1)), ResourceNotFound)
  }))

it.effect("lists across pages and filters by search", () =>
  Effect.gen(function*() {
    const { client, fake } = _setup()

    for (const n of ["alpha-1", "alpha-2", "alpha-3", "beta-1", "beta-2"]) {
      fake.seed({ name: n })
    }

    const all = yield* client.listZones({ perPage: 2 })
    assert.deepStrictEqual(all.map((z) => z.Name), ["alpha-1", "alpha-2", "alpha-3", "beta-1", "beta-2"])
    const found = yield* client.listZones({ search: "beta", perPage: 1 })
    assert.deepStrictEqual(found.map((z) => z.Name), ["beta-1", "beta-2"])
    assert.strictEqual((yield* client.listZones()).length, 5)
  }))

it.effect("checks availability", () =>
  Effect.gen(function*() {
    const { client, fake } = _setup()
    fake.seed({ name: "in-use" })
    assert.isTrue(yield* client.checkAvailability("free-name"))
    assert.isFalse(yield* client.checkAvailability("in-use"))
    assert.strictEqual(fake.writes().length, 0)
  }))

it.effect("deletes without linked pull zones", () =>
  Effect.gen(function*() {
    const { client, fake } = _setup()
    const seeded = fake.seed({ name: "doomed-zone" })
    yield* client.deleteZone(seeded.Id)
    assert.strictEqual(fake.peek().length, 0)
    const last = fake.requests().at(-1)
    assert.strictEqual(last?.method, "DELETE")
    assert.strictEqual(last?.search, "?deleteLinkedPullZones=false")
    yield* client.deleteZone(seeded.Id)
  }))

it.effect("lists regions", () =>
  Effect.gen(function*() {
    const { client } = _setup()
    const regions = yield* client.regions()
    assert.deepStrictEqual(regions.slice(0, 2).map((r) => r.Code), ["DE", "NY"])
    assert.strictEqual(regions.at(-1)?.Endpoint, null)
  }))

it.effect("maps a bad key to AuthenticationFailed", () =>
  Effect.gen(function*() {
    const fake = makeFakeBunnyStorage({ apiKey: "right" })
    const http = makeBunnyHttpClient({ base: fake.httpClient, apiKey: Redacted.make("wrong"), baseUrl: "https://fake.invalid" })
    assert.instanceOf(yield* Effect.flip(makeBunnyStorageClient(http).listZones()), AuthenticationFailed)
  }))

it.effect("checkAvailability fails closed on a malformed body", () =>
  Effect.gen(function*() {
    const client = makeBunnyStorageClient(
      HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, new Response("not json", { status: 200 }))))
    )

    const error = yield* Effect.flip(client.checkAvailability("x"))
    assert.isDefined(error)
  }))
