import { ConfigProvider, Effect, Layer, Predicate } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import { assert, describe, it } from "@effect/vitest"
import { makeFakeZone } from "../../cloudflare/dns/test/provider/fake-zone.ts"
import { dnsPreflight, dnsProviderLayerWith, reconcileDns, removeDns } from "../src/dns.ts"
import { missingCredentials, providerSections } from "../src/env-summary.ts"
import type { ClusterConfig } from "../src/cluster-config.ts"
import { fakeCredentials } from "./commands/fake-credentials.ts"
import { baseEncodedConfig, baseMksEncodedConfig, decodeTestConfig } from "./fixtures.ts"
import { validUpcloudUksConfig } from "./config/fixtures.ts"

const _dns = (ttl: number) => ({
  module: "cloudflare" as const,
  zone: "example.com",
  ttl,
  records: [{ name: "*.c1", target: "203.0.113.5" }, { name: "api", target: "api_server" }]
})

const _configs = (ttl: number): ReadonlyArray<readonly [string, ClusterConfig]> => [
  ["k3s", decodeTestConfig({ ...baseEncodedConfig, dns: _dns(ttl) })],
  ["ovh-mks", decodeTestConfig({ ...baseMksEncodedConfig, dns: _dns(ttl) })],
  ["upcloud-uks", decodeTestConfig({ ...validUpcloudUksConfig, dns: _dns(ttl) })]
]

const _env = (fake: ReturnType<typeof makeFakeZone>) => Layer.succeed(HttpClient.HttpClient, fake.httpClient)

const _targets = { api_server: { kind: "hostname", value: "abc123.k8s.example.net" } } as const

describe("cloudflare dns through dnsProviderLayerWith", () => {
  for (const [distro, config] of _configs(300)) {
    it.effect(`${distro}: apply writes unproxied records with dns.ttl and delete removes them`, () =>
      Effect.gen(function*() {
        const fake = makeFakeZone({ zone: "example.com" })
        const layer = dnsProviderLayerWith({ config }).pipe(Layer.provide(_env(fake)), Layer.provide(fakeCredentials))

        yield* reconcileDns({ config, targets: _targets }).pipe(Effect.provide(layer))

        assert.strictEqual(fake.peek({ name: "*.c1", type: "A" })?.content, "203.0.113.5")
        assert.strictEqual(fake.peek({ name: "*.c1", type: "A" })?.proxied, false)
        assert.strictEqual(fake.peek({ name: "api", type: "CNAME" })?.content, "abc123.k8s.example.net")
        assert.strictEqual(fake.peek({ name: "api", type: "TXT" })?.content, `"kumulo.cluster=${config.name}"`)
        assert.isTrue(fake.peekAll().every((r) => r.ttl === 300))

        const writes = fake.writes().length
        yield* reconcileDns({ config, targets: _targets }).pipe(Effect.provide(layer))
        assert.strictEqual(fake.writes().length, writes)

        yield* removeDns(config).pipe(Effect.provide(layer))
        assert.strictEqual(fake.peekAll().length, 0)
      }))
  }
})

describe("dnsPreflight with cloudflare", () => {
  const config = decodeTestConfig({ ...baseEncodedConfig, dns: _dns(300) })

  it.effect("looks the zone up and writes nothing", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com" })
      yield* dnsPreflight(config).pipe(Effect.provide(_env(fake)), Effect.provide(fakeCredentials))

      assert.deepStrictEqual(fake.requests().map((r) => r.path), ["/zones"])
      assert.include(fake.requests()[0]?.search ?? "", "name=example.com")
    }))

  it.effect("a zone the token cannot see fails with the permissions it needs", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com", visible: false })
      const error = yield* dnsPreflight(config).pipe(Effect.provide(_env(fake)), Effect.provide(fakeCredentials), Effect.flip)

      assert.isTrue(Predicate.isTagged(error, "ResourceNotFound"))
      assert.include(JSON.stringify(error), "Zone:Read and DNS:Edit")
    }))

  it.effect("a 403 fails with AuthenticationFailed", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com", failWith: 403 })
      const error = yield* dnsPreflight(config).pipe(Effect.provide(_env(fake)), Effect.provide(fakeCredentials), Effect.flip)

      assert.strictEqual(error._tag, "AuthenticationFailed")
    }))

  it.effect("a missing CLOUDFLARE_API_TOKEN fails before any request", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com" })
      const empty = Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env: {} }))
      const error = yield* dnsPreflight(config).pipe(Effect.provide(_env(fake)), Effect.provide(empty), Effect.flip)

      assert.strictEqual(error._tag, "AuthenticationFailed")
      assert.include(JSON.stringify(error), "CLOUDFLARE_API_TOKEN")
      assert.strictEqual(fake.requests().length, 0)
    }))

  it.effect("an unparseable CLOUDFLARE_API_BASE_URL fails with ConfigInvalid", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com" })

      const badUrl = Layer.succeed(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: { CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_API_BASE_URL: "not a url" } })
      )

      const error = yield* dnsPreflight(config).pipe(Effect.provide(_env(fake)), Effect.provide(badUrl), Effect.flip)

      assert.strictEqual(error._tag, "ConfigInvalid")
      assert.strictEqual(fake.requests().length, 0)
    }))
})

describe("cloudflare env summary", () => {
  const config = decodeTestConfig({ ...baseEncodedConfig, dns: _dns(300) })

  it("lists CLOUDFLARE_API_TOKEN for the dns section", () => {
    const section = providerSections(config).find((s) => s.title === "dns: cloudflare")
    assert.deepStrictEqual(section?.vars, ["CLOUDFLARE_API_TOKEN"])
  })

  it("reports the token as missing when absent", () => {
    assert.include(missingCredentials({ config, present: () => false }), "CLOUDFLARE_API_TOKEN")
  })
})
