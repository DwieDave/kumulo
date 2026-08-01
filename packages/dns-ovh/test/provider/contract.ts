import { assert, it } from "@effect/vitest"
import { Effect } from "effect"
import type { ClusterTag, DesiredRecord, DnsError } from "@kumulo/core"

export interface DnsProviderUnderTest {
  readonly ensureRecords: (zone: string, records: ReadonlyArray<DesiredRecord>) => Effect.Effect<void, DnsError>
  readonly removeClusterRecords: (zone: string, tag: ClusterTag) => Effect.Effect<void, DnsError>
}

export interface ContractHarness {
  readonly zone: string
  readonly provider: DnsProviderUnderTest
  readonly targetOf: (subDomain: string) => string | undefined
  readonly seedForeign: (subDomain: string, target: string) => void
  readonly seedForeignKind: (subDomain: string, fieldType: string, target: string) => void
  readonly seedForeignOwnerTxt: (subDomain: string, tag: string) => void
  readonly kindsAt: (subDomain: string) => ReadonlyArray<string>
}

const _ownedRecord = (): DesiredRecord => ({ name: "api.example.com", target: "10.0.0.1" })
const _ownershipRecord = (name: string, tag: string): DesiredRecord => ({ name, target: `kumulo.cluster=${tag}` })

export const runDnsProviderContractSuite = (build: () => ContractHarness): void => {
  it.effect("creates a missing record plus its TXT ownership record", () =>
    Effect.gen(function*() {
      const { zone, provider, targetOf } = build()
      const record = _ownedRecord()
      yield* provider.ensureRecords(zone, [_ownershipRecord(record.name, "cluster-a"), record])
      assert.strictEqual(targetOf(record.name), "10.0.0.1")
    }))

  it.effect("updates an owned record to the new desired target", () =>
    Effect.gen(function*() {
      const { zone, provider, targetOf } = build()
      const record = _ownedRecord()
      yield* provider.ensureRecords(zone, [_ownershipRecord(record.name, "cluster-a"), record])
      yield* provider.ensureRecords(zone, [_ownershipRecord(record.name, "cluster-a"), { ...record, target: "10.0.0.2" }])
      assert.strictEqual(targetOf(record.name), "10.0.0.2")
    }))

  it.effect("never mutates a record it does not own", () =>
    Effect.gen(function*() {
      const { zone, provider, targetOf, seedForeign } = build()
      const record = _ownedRecord()
      seedForeign(record.name, "203.0.113.9")
      const result = yield* Effect.flip(
        provider.ensureRecords(zone, [_ownershipRecord(record.name, "cluster-a"), record])
      )
      assert.strictEqual(result._tag, "ResourceConflict")
      assert.strictEqual(targetOf(record.name), "203.0.113.9")
    }))

  it.effect("never mutates a foreign record of a different kind at the same subdomain", () =>
    Effect.gen(function*() {
      const { zone, provider, targetOf, seedForeignKind } = build()
      const record = _ownedRecord()
      seedForeignKind(record.name, "CNAME", "other.example.com")
      const result = yield* Effect.flip(
        provider.ensureRecords(zone, [_ownershipRecord(record.name, "cluster-a"), record])
      )
      assert.strictEqual(result._tag, "ResourceConflict")
      assert.strictEqual(targetOf(record.name), "other.example.com")
    }))

  it.effect("never hijacks a foreign ownership TXT record for a different cluster", () =>
    Effect.gen(function*() {
      const { zone, provider, targetOf, seedForeignOwnerTxt } = build()
      const record = _ownedRecord()
      seedForeignOwnerTxt(record.name, "some-other-cluster")
      const result = yield* Effect.flip(
        provider.ensureRecords(zone, [_ownershipRecord(record.name, "cluster-a"), record])
      )
      assert.strictEqual(result._tag, "ResourceConflict")
      assert.strictEqual(targetOf(record.name), undefined)
    }))

  // landmine: RFC 1034 forbids CNAME beside other data at the same name, kind changes must migrate not add
  it.effect("migrates an owned record to a new kind instead of leaving both", () =>
    Effect.gen(function*() {
      const { zone, provider, targetOf, kindsAt } = build()
      const name = "www.example.com"
      const owner = _ownershipRecord(name, "cluster-a")
      yield* provider.ensureRecords(zone, [owner, { name, target: "lb.example.net" }])
      assert.deepStrictEqual(kindsAt(name), ["CNAME", "TXT"])
      yield* provider.ensureRecords(zone, [owner, { name, target: "203.0.113.1" }])
      assert.deepStrictEqual(kindsAt(name), ["A", "TXT"])
      assert.strictEqual(targetOf(name), "203.0.113.1")
    }))

  it.effect("removeClusterRecords only deletes records owned by the given tag", () =>
    Effect.gen(function*() {
      const { zone, provider, targetOf } = build()
      const owned = _ownedRecord()
      const other = { name: "api.other.example.com", target: "10.0.0.9" }
      yield* provider.ensureRecords(zone, [_ownershipRecord(owned.name, "cluster-a"), owned])
      yield* provider.ensureRecords(zone, [_ownershipRecord(other.name, "cluster-b"), other])
      yield* provider.removeClusterRecords(zone, "cluster-a")
      assert.strictEqual(targetOf(owned.name), undefined)
      assert.strictEqual(targetOf(other.name), "10.0.0.9")
    }))
}
