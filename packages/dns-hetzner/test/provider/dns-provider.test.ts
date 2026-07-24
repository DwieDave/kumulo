import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { makeHetznerDnsProvider } from "../../src/provider/dns-provider.ts"
import { makeFakeZone } from "./fake-zone.ts"
import { runDnsProviderContractSuite } from "./contract.ts"

const _zone = "example.com"

describe("hetzner dns-hetzner provider — port contract", () => {
  runDnsProviderContractSuite(() => {
    const fake = makeFakeZone(_zone)
    return {
      zone: _zone,
      provider: makeHetznerDnsProvider(fake.dns),
      targetOf: (subDomain) => fake.peek(subDomain)?.records[0]?.value,
      seedForeign: (subDomain, target) => fake.seed({ type: "A", name: subDomain, target }),
      seedForeignKind: (subDomain, fieldType, target) => fake.seed({ type: fieldType, name: subDomain, target }),
      seedForeignOwnerTxt: (subDomain, tag) => fake.seed({ type: "TXT", name: subDomain, target: `kumulo.cluster=${tag}` })
    }
  })
})

describe("hetzner dns-hetzner provider — fixture-replay specifics", () => {
  it.effect("is idempotent: a second identical ensureRecords makes no further calls", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone(_zone)
      const provider = makeHetznerDnsProvider(fake.dns)
      const desired = [
        { name: "api.example.com", target: "kumulo.cluster=cluster-a" },
        { name: "api.example.com", target: "10.0.0.1" }
      ]
      yield* provider.ensureRecords(_zone, desired)
      yield* provider.ensureRecords(_zone, desired)
      assert.strictEqual(fake.peekAll().length, 2)
    }))

  it.effect("preserves the existing ttl across an update instead of resetting it", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone(_zone)
      fake.seed({ type: "TXT", name: "api.example.com", target: "kumulo.cluster=cluster-a" })
      fake.seed({ type: "A", name: "api.example.com", target: "10.0.0.1", ttl: 600 })
      const provider = makeHetznerDnsProvider(fake.dns)
      yield* provider.ensureRecords(_zone, [
        { name: "api.example.com", target: "kumulo.cluster=cluster-a" },
        { name: "api.example.com", target: "10.0.0.2" }
      ])
      const existing = fake.peekAll().find((r) => r.name === "api.example.com" && r.type === "A")
      assert.strictEqual(existing?.ttl, 600)
      assert.strictEqual(existing?.records[0]?.value, "10.0.0.2")
    }))

  it.effect("does nothing when there is nothing to ensure", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone(_zone)
      const provider = makeHetznerDnsProvider(fake.dns)
      yield* provider.ensureRecords(_zone, [])
      assert.strictEqual(fake.peekAll().length, 0)
    }))
})
