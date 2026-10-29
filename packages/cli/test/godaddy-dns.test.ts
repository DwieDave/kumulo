import { ConfigProvider, Effect, Layer } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { assert, describe, it } from "@effect/vitest"
import { makeFakeZone } from "../../godaddy/dns/test/provider/fake-zone.ts"
import { dnsPreflight, dnsProviderLayerFor, reconcileDns, removeDns } from "../src/dns.ts"
import { missingCredentials, providerSections } from "../src/env-summary.ts"
import type { ClusterConfig } from "../src/cluster-config.ts"
import { fakeCredentials } from "./commands/fake-credentials.ts"
import { baseEncodedConfig, baseMksEncodedConfig, decodeTestConfig } from "./fixtures.ts"
import { validUpcloudUksConfig } from "./config/fixtures.ts"

const _dns = (ttl: number) => ({
  module: "godaddy" as const,
  zone: "example.com",
  ttl,
  records: [{ name: "api", target: "203.0.113.5" }]
})

const _configs = (ttl: number): ReadonlyArray<readonly [string, ClusterConfig]> => [
  ["k3s", decodeTestConfig({ ...baseEncodedConfig, dns: _dns(ttl) })],
  ["ovh-mks", decodeTestConfig({ ...baseMksEncodedConfig, dns: _dns(ttl) })],
  ["upcloud-uks", decodeTestConfig({ ...validUpcloudUksConfig, dns: _dns(ttl) })]
]

const _env = (fake: ReturnType<typeof makeFakeZone>) => Layer.succeed(HttpClient.HttpClient, fake.httpClient)

const _targets = { api_server: { kind: "ip", value: "203.0.113.1" } } as const

describe("godaddy dns through dnsProviderLayerFor", () => {
  for (const [distro, config] of _configs(900)) {
    it.effect(`${distro}: apply writes records with dns.ttl and delete removes them`, () =>
      Effect.gen(function*() {
        const fake = makeFakeZone({ zone: "example.com" })
        const layer = dnsProviderLayerFor(config).pipe(Layer.provide(_env(fake)), Layer.provide(fakeCredentials))

        yield* reconcileDns({ config, targets: _targets }).pipe(Effect.provide(layer))

        const api = fake.peek({ name: "api", type: "A" })
        assert.strictEqual(api?.data, "203.0.113.5")
        assert.strictEqual(api?.ttl, 900)
        assert.isTrue(fake.peekAll().every((r) => r.ttl === 900))

        const writes = fake.writes().length
        yield* reconcileDns({ config, targets: _targets }).pipe(Effect.provide(layer))
        assert.strictEqual(fake.writes().length, writes)

        yield* removeDns(config).pipe(Effect.provide(layer))
        assert.isUndefined(fake.peek({ name: "api", type: "A" }))
        assert.strictEqual(fake.peekAll().length, 0)
      }))
  }
})

describe("dnsPreflight", () => {
  const config = decodeTestConfig({ ...baseEncodedConfig, dns: _dns(600) })

  it.effect("lists a single record and writes nothing", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com" })
      yield* dnsPreflight(config).pipe(Effect.provide(_env(fake)), Effect.provide(fakeCredentials))

      assert.strictEqual(fake.requests().length, 1)
      assert.include(fake.requests()[0]?.search ?? "", "pageSize=1")
      assert.strictEqual(fake.writes().length, 0)
    }))

  it.effect("a 403 fails with the scope and eligibility hint", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com", forbiddenCode: "ACCESS_DENIED" })

      const error = yield* dnsPreflight(config).pipe(
        Effect.provide(_env(fake)),
        Effect.provide(fakeCredentials),
        Effect.flip
      )

      assert.strictEqual(error._tag, "AuthenticationFailed")
      assert.include(JSON.stringify(error), "domains.dns:update")
      assert.strictEqual(fake.writes().length, 0)
    }))

  it.effect("a 401 hints that the token is missing, expired or revoked", () =>
    Effect.gen(function*() {
      const unauthorized = HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{\"code\":\"UNAUTHORIZED\",\"message\":\"bad token\"}", { status: 401 })))
      )


      const error = yield* dnsPreflight(config).pipe(
        Effect.provide(Layer.succeed(HttpClient.HttpClient, unauthorized)),
        Effect.provide(fakeCredentials),
        Effect.flip
      )

      assert.strictEqual(error._tag, "AuthenticationFailed")
      assert.include(JSON.stringify(error), "missing, expired or revoked")
    }))

  it.effect("an unparseable GODADDY_API_BASE_URL fails with ConfigInvalid", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com" })

      const badUrl = Layer.succeed(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: { GODADDY_API_TOKEN: "t", GODADDY_API_BASE_URL: "not a url" } })
      )

      const error = yield* dnsPreflight(config).pipe(Effect.provide(_env(fake)), Effect.provide(badUrl), Effect.flip)

      assert.strictEqual(error._tag, "ConfigInvalid")
      assert.strictEqual(fake.requests().length, 0)
    }))

  it.effect("non-godaddy modules make no requests", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com", forbiddenCode: "ACCESS_DENIED" })

      const other = decodeTestConfig({
        ...baseEncodedConfig,
        dns: { module: "hetzner", zone: "example.com", ttl: 300, records: [] }
      })

      yield* dnsPreflight(other).pipe(Effect.provide(_env(fake)), Effect.provide(fakeCredentials))
      yield* dnsPreflight(decodeTestConfig(baseEncodedConfig)).pipe(Effect.provide(_env(fake)))

      assert.strictEqual(fake.requests().length, 0)
    }))
})

describe("godaddy env summary", () => {
  const config = decodeTestConfig({ ...baseEncodedConfig, dns: _dns(600) })

  it("lists GODADDY_API_TOKEN for the dns section", () => {
    const section = providerSections(config).find((s) => s.title === "dns: godaddy")
    assert.isDefined(section)
    assert.include(JSON.stringify(section), "GODADDY_API_TOKEN")
  })

  it("reports the token as missing when absent", () => {
    assert.include(JSON.stringify(missingCredentials({ config, present: () => false })), "GODADDY_API_TOKEN")
  })
})
