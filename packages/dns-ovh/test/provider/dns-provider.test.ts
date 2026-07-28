import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { makeOvhDnsProvider } from "../../src/provider/dns-provider.ts"
import { makeFakeZone } from "./fake-zone.ts"
import { runDnsProviderContractSuite } from "./contract.ts"

const _zone = "example.com"

describe("ovh dns-ovh provider — port contract", () => {
  runDnsProviderContractSuite(() => {
    const fake = makeFakeZone(_zone)
    return {
      zone: _zone,
      provider: makeOvhDnsProvider(fake.dns),
      targetOf: (subDomain) => fake.peek(subDomain)?.target,
      seedForeign: (subDomain, target) => fake.seed({ fieldType: "A", subDomain, target }),
      seedForeignKind: (subDomain, fieldType, target) => fake.seed({ fieldType, subDomain, target }),
      seedForeignOwnerTxt: (subDomain, tag) => fake.seed({ fieldType: "TXT", subDomain, target: `kumulo.cluster=${tag}` }),
      kindsAt: (subDomain) => fake.peekAll().filter((r) => r.subDomain === subDomain).map((r) => r.fieldType).sort()
    }
  })
})

describe("ovh dns-ovh provider — fixture-replay specifics", () => {
  it.effect("refreshes the zone exactly once per ensureRecords call", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone(_zone)
      const provider = makeOvhDnsProvider(fake.dns)
      yield* provider.ensureRecords(_zone, [
        { name: "api.example.com", target: "kumulo.cluster=cluster-a" },
        { name: "api.example.com", target: "10.0.0.1" }
      ])
      assert.strictEqual(fake.refreshCount(), 1)
    }))

  it.effect("is idempotent: a second identical ensureRecords makes no further calls", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone(_zone)
      const provider = makeOvhDnsProvider(fake.dns)
      const desired = [
        { name: "api.example.com", target: "kumulo.cluster=cluster-a" },
        { name: "api.example.com", target: "10.0.0.1" }
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
})
