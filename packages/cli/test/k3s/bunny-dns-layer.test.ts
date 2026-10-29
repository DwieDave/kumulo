import { Effect, Layer } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import { assert, describe, it } from "@effect/vitest"
import { makeFakeBunnyDns } from "@kumulo/bunny"
import { dnsProviderLayerFor, reconcileDns } from "../../src/dns.ts"
import { fakeCredentials } from "../commands/fake-credentials.ts"
import { baseEncodedConfig, decodeTestConfig } from "../fixtures.ts"

const _config = (ttl: number) =>
  decodeTestConfig({
    ...baseEncodedConfig,
    dns: { module: "bunny", zone: "example.com", ttl, records: [{ name: "api", target: "203.0.113.5" }] }
  })

const _ensure = ({ fake, ttl }: { readonly fake: ReturnType<typeof makeFakeBunnyDns>; readonly ttl: number }) => {
  const config = _config(ttl)

  return reconcileDns({ config, targets: { api_server: { kind: "ip", value: "203.0.113.1" } } }).pipe(
    Effect.provide(dnsProviderLayerFor(config).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, fake.httpClient)))),
    Effect.provide(fakeCredentials)
  )
}

describe("bunny DNS layer", () => {
  it.effect("writes records with the configured dns.ttl", () =>
    Effect.gen(function*() {
      const fake = makeFakeBunnyDns()
      const zoneId = fake.seedZone("example.com")

      yield* _ensure({ fake, ttl: 120 })

      const records = fake.peekRecords(zoneId)

      assert.isAbove(records.length, 0)
      assert.isTrue(records.every((record) => record.Ttl === 120))
    }))

  it.effect("a changed dns.ttl updates the existing records", () =>
    Effect.gen(function*() {
      const fake = makeFakeBunnyDns()
      const zoneId = fake.seedZone("example.com")

      yield* _ensure({ fake, ttl: 300 })
      yield* _ensure({ fake, ttl: 60 })

      assert.isTrue(fake.peekRecords(zoneId).every((record) => record.Ttl === 60))
    }))
})
