import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { makeFakeBunnyDns } from "@kumulo/bunny"
import { makeBunnyDnsProvider } from "../../src/provider/dns-provider.ts"
import { runDnsProviderContractSuite } from "./contract.ts"

const _zone = "example.com"

const _owner = (name: string, tag = "cluster-a") => ({ name, target: `kumulo.cluster=${tag}` })

const _relative = (name: string): string => name === _zone ? "" : name.replace(`.${_zone}`, "")

const _setup = (pullZoneIdFor?: (hostname: string) => number | undefined) => {
  const fake = makeFakeBunnyDns()
  const zoneId = fake.seedZone(_zone)

  return { fake, zoneId, provider: makeBunnyDnsProvider({ dns: fake.dns, pullZoneIdFor }) }
}

describe("bunny dns provider — port contract", () => {
  runDnsProviderContractSuite(() => {
    const { fake, provider, zoneId } = _setup()
    const at = (name: string) => fake.peekRecords(zoneId).filter((r) => r.Name === _relative(name))

    return {
      zone: _zone,
      provider,
      targetOf: (name) => at(name).find((r) => r.Type !== "TXT")?.Value ?? undefined,
      seedForeign: (name, target) =>
        void fake.seedRecord({ zoneId, record: { Name: _relative(name), Type: "A", Value: target, Ttl: 300 } }),
      seedForeignKind: (name, type, target) =>
        void fake.seedRecord({
          zoneId,
          record: { Name: _relative(name), Type: type === "CNAME" ? "CNAME" : "A", Value: target, Ttl: 300 }
        }),
      seedForeignOwnerTxt: (name, tag) =>
        void fake.seedRecord({ zoneId, record: { Name: _relative(name), Type: "TXT", Value: `kumulo.cluster=${tag}`, Ttl: 300 } }),
      kindsAt: (name) => at(name).map((r) => r.Type).toSorted()
    }
  })
})

describe("bunny dns provider — bunny specifics", () => {
  const desired = [_owner("api.example.com"), { name: "api.example.com", target: "10.0.0.1" }]

  it.effect("makes no writes on a second apply", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      yield* provider.ensureRecords(_zone, desired)
      fake.clearRequests()
      yield* provider.ensureRecords(_zone, desired)
      assert.strictEqual(fake.peekWrites().length, 0)
    }))

  it.effect("tags created records with a managed-by comment", () =>
    Effect.gen(function*() {
      const { fake, provider, zoneId } = _setup()
      yield* provider.ensureRecords(_zone, desired)
      assert.isTrue(fake.peekRecords(zoneId).every((r) => r.Comment === "managed by kumulo (cluster-a)"))
    }))

  it.effect("treats empty and @ as the apex", () =>
    Effect.gen(function*() {
      const { fake, provider, zoneId } = _setup()
      fake.seedRecord({ zoneId, record: { Name: "@", Type: "TXT", Value: "kumulo.cluster=cluster-a", Ttl: 300 } })
      fake.seedRecord({ zoneId, record: { Name: "", Type: "A", Value: "10.0.0.1", Ttl: 300 } })
      fake.clearRequests()
      yield* provider.ensureRecords(_zone, [_owner(_zone), { name: _zone, target: "10.0.0.1" }])
      assert.strictEqual(fake.peekWrites().length, 0)
      yield* provider.ensureRecords(_zone, [_owner(_zone), { name: _zone, target: "10.0.0.2" }])
      assert.deepStrictEqual(fake.peekRecords(zoneId).filter((r) => r.Type === "A").map((r) => r.Value), ["10.0.0.2"])
    }))

  it.effect("collapses duplicate records to one at the desired ttl", () =>
    Effect.gen(function*() {
      const { fake, provider, zoneId } = _setup()
      fake.seedRecord({ zoneId, record: { Name: "api", Type: "TXT", Value: "kumulo.cluster=cluster-a", Ttl: 300 } })
      fake.seedRecord({ zoneId, record: { Name: "api", Type: "A", Value: "10.0.0.1", Ttl: 600 } })
      fake.seedRecord({ zoneId, record: { Name: "api", Type: "A", Value: "10.0.0.7", Ttl: 600 } })
      yield* provider.ensureRecords(_zone, desired)
      const a = fake.peekRecords(zoneId).filter((r) => r.Type === "A")
      assert.strictEqual(a.length, 1)
      assert.strictEqual(a[0]?.Value, "10.0.0.1")
      assert.strictEqual(a[0]?.Ttl, 300)
    }))

  it.effect("conflicts on foreign and other-cluster TXT records", () =>
    Effect.gen(function*() {
      const { fake, provider, zoneId } = _setup()
      fake.seedRecord({ zoneId, record: { Name: "api", Type: "TXT", Value: "kumulo.cluster=cluster-b", Ttl: 300 } })
      const error = yield* Effect.flip(provider.ensureRecords(_zone, desired))
      assert.strictEqual(error._tag, "ResourceConflict")
      assert.strictEqual(fake.peekRecords(zoneId).length, 1)
    }))

  it.effect("fails with ResourceNotFound when the zone is missing", () =>
    Effect.gen(function*() {
      const { provider } = _setup()
      const error = yield* Effect.flip(provider.ensureRecords("missing.org", desired))
      assert.strictEqual(error._tag, "ResourceNotFound")
    }))

  it.effect("does not match a zone by substring", () =>
    Effect.gen(function*() {
      const fake = makeFakeBunnyDns()
      fake.seedZone("sub.example.com")
      const provider = makeBunnyDnsProvider({ dns: fake.dns })
      const error = yield* Effect.flip(provider.ensureRecords(_zone, desired))
      assert.strictEqual(error._tag, "ResourceNotFound")
    }))

  it.effect("writes a PullZone record for a cdn target at the apex", () =>
    Effect.gen(function*() {
      const { fake, provider, zoneId } = _setup((host) => host === "site.b-cdn.net" ? 42 : undefined)
      const records = [_owner(_zone), { name: _zone, target: "site.b-cdn.net" }]
      yield* provider.ensureRecords(_zone, records)
      const pz = fake.peekRecords(zoneId).find((r) => r.Type === "PullZone")
      assert.strictEqual(pz?.PullZoneId, 42)
      fake.clearRequests()
      yield* provider.ensureRecords(_zone, records)
      assert.strictEqual(fake.peekWrites().length, 0)
    }))

  it.effect("writes a CNAME for a cdn target below the apex", () =>
    Effect.gen(function*() {
      const { fake, provider, zoneId } = _setup(() => 42)
      yield* provider.ensureRecords(_zone, [_owner("www.example.com"), { name: "www.example.com", target: "site.b-cdn.net" }])
      assert.deepStrictEqual(fake.peekRecords(zoneId).map((r) => r.Type).toSorted(), ["CNAME", "TXT"])
    }))

  it.effect("removeClusterRecords deletes every record at owned names", () =>
    Effect.gen(function*() {
      const { fake, provider, zoneId } = _setup()
      yield* provider.ensureRecords(_zone, desired)
      yield* provider.removeClusterRecords(_zone, "cluster-a")
      assert.strictEqual(fake.peekRecords(zoneId).length, 0)
    }))

  it.effect("updates a record when only the ttl differs and is then idempotent", () =>
    Effect.gen(function*() {
      const fake = makeFakeBunnyDns()
      const zoneId = fake.seedZone(_zone)
      const slow = makeBunnyDnsProvider({ dns: fake.dns, ttl: 300 })
      yield* slow.ensureRecords(_zone, desired)
      const fast = makeBunnyDnsProvider({ dns: fake.dns, ttl: 60 })
      yield* fast.ensureRecords(_zone, desired)
      assert.isTrue(fake.peekRecords(zoneId).every((r) => r.Ttl === 60))
      fake.clearRequests()
      yield* fast.ensureRecords(_zone, desired)
      assert.strictEqual(fake.peekWrites().length, 0)
    }))

  it.effect("matches a PullZone apex record via AcceleratedPullZoneId without writes", () =>
    Effect.gen(function*() {
      const fake = makeFakeBunnyDns()
      const zoneId = fake.seedZone(_zone)

      const dns = {
        ...fake.dns,
        listRecords: (args: { readonly zoneId: number }) =>
          Effect.map(fake.dns.listRecords(args), (records) =>
            records.map(({ PullZoneId, ...rest }) => PullZoneId === undefined ? rest : { ...rest, AcceleratedPullZoneId: PullZoneId }))
      }

      const provider = makeBunnyDnsProvider({ dns, pullZoneIdFor: () => 42 })
      fake.seedRecord({ zoneId, record: { Name: "", Type: "TXT", Value: "kumulo.cluster=cluster-a", Ttl: 300 } })
      fake.seedRecord({ zoneId, record: { Name: "", Type: "PullZone", Value: "", Ttl: 300, PullZoneId: 42 } })
      fake.clearRequests()
      yield* provider.ensureRecords(_zone, [_owner(_zone), { name: _zone, target: "site.b-cdn.net" }])
      assert.strictEqual(fake.peekWrites().length, 0)
    }))

  it.effect("kind change keeps NS, MX and foreign TXT at an owned name", () =>
    Effect.gen(function*() {
      const { fake, provider, zoneId } = _setup()
      const owner = _owner("www.example.com")
      yield* provider.ensureRecords(_zone, [owner, { name: "www.example.com", target: "lb.example.net" }])
      fake.seedRecord({ zoneId, record: { Name: "www", Type: "NS", Value: "ns.example.net", Ttl: 300 } })
      fake.seedRecord({ zoneId, record: { Name: "www", Type: "MX", Value: "mail.example.net", Ttl: 300 } })
      fake.seedRecord({ zoneId, record: { Name: "www", Type: "TXT", Value: "v=spf1 -all", Ttl: 300 } })
      yield* provider.ensureRecords(_zone, [owner, { name: "www.example.com", target: "203.0.113.1" }])
      assert.deepStrictEqual(fake.peekRecords(zoneId).map((r) => r.Type).toSorted(), ["A", "MX", "NS", "TXT", "TXT"])
    }))

  it.effect("removeClusterRecords keeps NS, MX and foreign TXT at an owned name", () =>
    Effect.gen(function*() {
      const { fake, provider, zoneId } = _setup()
      yield* provider.ensureRecords(_zone, desired)
      fake.seedRecord({ zoneId, record: { Name: "api", Type: "NS", Value: "ns.example.net", Ttl: 300 } })
      fake.seedRecord({ zoneId, record: { Name: "api", Type: "MX", Value: "mail.example.net", Ttl: 300 } })
      fake.seedRecord({ zoneId, record: { Name: "api", Type: "TXT", Value: "v=spf1 -all", Ttl: 300 } })
      yield* provider.removeClusterRecords(_zone, "cluster-a")
      assert.deepStrictEqual(fake.peekRecords(zoneId).map((r) => r.Type).toSorted(), ["MX", "NS", "TXT"])
    }))
})
