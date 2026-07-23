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
}

const _ownedRecord = (): DesiredRecord => ({ name: "api.example.com", target: "10.0.0.1" })
const _ownershipRecord = (name: string, tag: string): DesiredRecord => ({ name, target: `kumulo.cluster=${tag}` })

/**
 * Port-contract suite for `DnsProvider` (FR-7): reusable across every
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
