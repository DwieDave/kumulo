import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { dnsProviderContract } from "@kumulo/core/testing"
import { makeOvhDnsProvider } from "../../src/provider/dns-provider.ts"
import { makeFakeZone } from "./fake-zone.ts"


const _zone = "example.com"

describe("ovh dns-ovh provider — port contract", () => {
  dnsProviderContract(() => {
    const fake = makeFakeZone(_zone)

    // contract names are FQDNs, the fake stores OVH's relative subDomain
    const sub = (name: string): string => name.replace(`.${_zone}`, "")

    return {
      zone: _zone,
      provider: makeOvhDnsProvider(fake.dns),
      targetOf: (name) => fake.peek(sub(name))?.target,
      seedForeign: (name, target) => fake.seed({ fieldType: "A", subDomain: sub(name), target }),
      seedForeignKind: (name, fieldType, target) => fake.seed({ fieldType, subDomain: sub(name), target }),
      seedForeignOwnerTxt: (name, tag) => fake.seed({ fieldType: "TXT", subDomain: sub(name), target: `kumulo.cluster=${tag}` }),
      seedForeignTxt: (name, value) => fake.seed({ fieldType: "TXT", subDomain: sub(name), target: value }),
      kindsAt: (name) => fake.peekAll().flatMap((r) => r.subDomain === sub(name) ? [r.fieldType] : []).toSorted(),
      valuesAt: (name, type) => fake.peekAll().flatMap((r) => r.subDomain === sub(name) && r.fieldType === type ? [r.target] : [])
    }
  })
})

describe("ovh dns-ovh provider — fixture-replay specifics", () => {
  it.effect("refreshes the zone exactly once per ensureRecords call", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone(_zone)
      const provider = makeOvhDnsProvider(fake.dns)
      yield* provider.ensureRecords(_zone, [
        { name: "api", target: "kumulo.cluster=cluster-a" },
        { name: "api", target: "10.0.0.1" }
      ])
      assert.strictEqual(fake.refreshCount(), 1)
    }))

  it.effect("is idempotent: a second identical ensureRecords makes no further calls", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone(_zone)
      const provider = makeOvhDnsProvider(fake.dns)

      const desired = [
        { name: "api", target: "kumulo.cluster=cluster-a" },
        { name: "api", target: "10.0.0.1" }
      ]

      yield* provider.ensureRecords(_zone, desired)
      yield* provider.ensureRecords(_zone, desired)
      assert.strictEqual(fake.peekAll().length, 2)
    }))

  it.effect("does not refresh the zone when there is nothing to ensure", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone(_zone)
      const provider = makeOvhDnsProvider(fake.dns)
      yield* provider.ensureRecords(_zone, [])
      assert.strictEqual(fake.refreshCount(), 0)
    }))

  it.effect("writes an FQDN name as OVH's relative subDomain and the apex as empty", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone(_zone)
      const provider = makeOvhDnsProvider(fake.dns)

      yield* provider.ensureRecords(_zone, [
        { name: "api.example.com", target: "10.0.0.1" },
        { name: "example.com", target: "10.0.0.2" }
      ])

      assert.deepStrictEqual(fake.peekAll().map((r) => r.subDomain).toSorted(), ["", "api"])
    }))
})
