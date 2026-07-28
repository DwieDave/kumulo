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
  /** Direct backend inspection, bypassing the provider under test. */
  readonly targetOf: (subDomain: string) => string | undefined
  /** Seeds a record directly in the backend, bypassing ownership rules. */
  readonly seedForeign: (subDomain: string, target: string) => void
  /** Seeds a foreign record of a specific kind directly in the backend, bypassing ownership rules. */
  readonly seedForeignKind: (subDomain: string, fieldType: string, target: string) => void
  /** Seeds a foreign TXT ownership record (a different cluster's tag) directly in the backend. */
  readonly seedForeignOwnerTxt: (subDomain: string, tag: string) => void
  /** Every record kind present at a subdomain, sorted — a name may only ever hold one non-TXT kind. */
  readonly kindsAt: (subDomain: string) => ReadonlyArray<string>
}

const _ownedRecord = (): DesiredRecord => ({ name: "api.example.com", target: "10.0.0.1" })
const _ownershipRecord = (name: string, tag: string): DesiredRecord => ({ name, target: `kumulo.cluster=${tag}` })

/**
 * Port-contract suite for `DnsProvider`: reusable across every
 * implementation (ovh, designate, ...) by supplying a harness. Exercises
 * create/update-to-desired-state, the TXT ownership guard, and
 * tag-scoped deletion — the parts of the contract every backend must honor.
 */
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
      seedForeign(record.name, "203.0.113.9") // pre-existing, no ownership TXT
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
      seedForeignKind(record.name, "CNAME", "other.example.com") // foreign, different kind than desired "A"
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

  // A record's kind changes when its target does (a CNAME to a hostname becomes
  // an A to an address). RFC 1034 3.6.2 forbids a CNAME beside any other data at
  // the same name, so the stale kind has to go rather than sit next to the new
  // one — this is the only place that can migrate it, since `removeClusterRecords`
  // never runs on an apply.
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
