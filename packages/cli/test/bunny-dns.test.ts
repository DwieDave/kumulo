import { assert, it } from "@effect/vitest"
import { Effect } from "effect"
import { DnsProvider } from "@kumulo/core"
import { bunnyDnsProviderLive } from "@kumulo/dns-bunny"
import { makeFakeBunnyDns } from "@kumulo/bunny"
import { dnsPlanActions } from "../src/dns-plan.ts"
import { desiredRecords, reconcileDns } from "../src/dns.ts"
import { baseEncodedConfig, decodeK3sTestConfig } from "./fixtures.ts"

const _config = decodeK3sTestConfig({
  ...baseEncodedConfig,
  dns: { module: "bunny", zone: "example.com", ttl: 300, records: [{ name: "api", target: "api_server" }] }
})

const _targets = { api_server: { kind: "ip", value: "10.0.0.1" } } as const

it("plans an A record for a bunny zone", () => {
  assert.strictEqual(
    dnsPlanActions({ config: _config.dns, targets: { api_server: "ip" } }).length,
    1
  )
})

it.effect("applies bunny dns against the fake server and is idempotent", () =>
  Effect.gen(function*() {
    const fake = makeFakeBunnyDns()
    const zoneId = fake.seedZone("example.com")
    const layer = bunnyDnsProviderLive({ dns: fake.dns })

    yield* reconcileDns({ config: _config, targets: _targets }).pipe(Effect.provide(layer))
    const created = fake.peekRecords(zoneId)
    assert.strictEqual(created.length, desiredRecords({ config: _config, targets: _targets }).length)
    assert.isTrue(created.some((r) => r.Type === "A" && r.Value === "10.0.0.1"))

    fake.clearRequests()
    yield* reconcileDns({ config: _config, targets: _targets }).pipe(Effect.provide(layer))
    assert.strictEqual(fake.peekWrites().length, 0)
  }))

it.effect("exposes the provider through the DnsProvider service", () =>
  Effect.gen(function*() {
    const dns = yield* DnsProvider
    assert.isFunction(dns.ensureRecords)
  }).pipe(Effect.provide(bunnyDnsProviderLive({ dns: makeFakeBunnyDns().dns }))))
