import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { makeHetznerDnsProvider } from "../../src/provider/dns-provider.ts"
import { dnsProviderContract } from "@kumulo/core/testing"
import { makeFakeZone } from "./fake-zone.ts"


const _zone = "example.com"

// the provider talks in relative rrset names ("api"), configs in FQDNs
const _rel = (name: string): string => name.endsWith(`.${_zone}`) ? name.slice(0, -(_zone.length + 1)) : name

describe("hetzner dns-hetzner provider — port contract", () => {
  dnsProviderContract(() => {
    const fake = makeFakeZone(_zone)

    return {
      zone: _zone,
      provider: makeHetznerDnsProvider({ dns: fake.dns }),
      targetOf: (subDomain) => fake.peek(_rel(subDomain))?.records[0]?.value,
      seedForeign: (subDomain, target) => fake.seed({ type: "A", name: _rel(subDomain), target }),
      seedForeignKind: (subDomain, fieldType, target) => fake.seed({ type: fieldType, name: _rel(subDomain), target }),
      seedForeignOwnerTxt: (subDomain, tag) => fake.seed({ type: "TXT", name: _rel(subDomain), target: `kumulo.cluster=${tag}` }),
      seedForeignTxt: (subDomain, value) => fake.seed({ type: "TXT", name: _rel(subDomain), target: value }),
      kindsAt: (subDomain) => fake.peekAll().flatMap((r) => r.name === _rel(subDomain) ? [r.type] : []).toSorted(),
      valuesAt: (subDomain, fieldType) =>
        fake.peekAll().filter((r) => r.name === _rel(subDomain) && r.type === fieldType).flatMap((r) => r.records.map((v) => v.value))
    }
  })
})

describe("hetzner dns-hetzner provider — fixture-replay specifics", () => {
  it.effect("is idempotent: a second identical ensureRecords makes no further calls", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone(_zone)
      const provider = makeHetznerDnsProvider({ dns: fake.dns })

      const desired = [
        { name: "api.example.com", target: "kumulo.cluster=cluster-a" },
        { name: "api.example.com", target: "10.0.0.1" }
      ]

      yield* provider.ensureRecords(_zone, desired)
      yield* provider.ensureRecords(_zone, desired)
      assert.strictEqual(fake.peekAll().length, 2)
    }))

  it.effect("converges the ttl to the configured value on update", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone(_zone)
      fake.seed({ type: "TXT", name: "api", target: "kumulo.cluster=cluster-a" })
      fake.seed({ type: "A", name: "api", target: "10.0.0.1", ttl: 600 })
      const provider = makeHetznerDnsProvider({ dns: fake.dns })
      yield* provider.ensureRecords(_zone, [
        { name: "api.example.com", target: "kumulo.cluster=cluster-a" },
        { name: "api.example.com", target: "10.0.0.2" }
      ])
      const existing = fake.peekAll().find((r) => r.name === "api" && r.type === "A")
      assert.strictEqual(existing?.ttl, 300)
      assert.strictEqual(existing?.records[0]?.value, "10.0.0.2")
    }))

  it.effect("does nothing when there is nothing to ensure", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone(_zone)
      const provider = makeHetznerDnsProvider({ dns: fake.dns })
      yield* provider.ensureRecords(_zone, [])
      assert.strictEqual(fake.peekAll().length, 0)
    }))
})
