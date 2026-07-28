import { Effect, Layer } from "effect"
import { DnsProvider, ResourceConflict } from "@kumulo/core"
import type { ClusterTag, DesiredRecord, DnsError } from "@kumulo/core"
import type { HetznerDns, HetznerDnsError, HetznerRRset } from "../client/hetzner-dns.ts"
import { toDnsError } from "./errors.ts"
import { rrsetsAt } from "./existing.ts"
import type { DnsRecordKind } from "./ownership.ts"
import { ownerTagOf, recordKind } from "./ownership.ts"

// kumulo: `DesiredRecord` (core, off-limits — see D1/R3) carries no ttl.
// Hetzner's PUT-the-whole-rrset requires one: preserve an existing rrset's
// ttl across updates (idempotent, N1), default to this on first create.
// Revisit if `ClusterConfig.dns.ttl` ever threads through the `DnsProvider`
// port to every implementation.
const _DEFAULT_TTL = 300

const _wrap = (
  zone: string,
  name: string,
  self: Effect.Effect<unknown, HetznerDnsError>
): Effect.Effect<void, DnsError> => Effect.asVoid(Effect.mapError(self, (cause) => toDnsError({ cause, zone, name })))

const _isOwnershipRecord = (record: DesiredRecord): boolean => ownerTagOf(record.target) !== undefined

/** Same-name TXT ownership record within this `ensureRecords` batch, if the caller included one. */
const _ownerTargetFor = (records: ReadonlyArray<DesiredRecord>, name: string): string | undefined =>
  records.find((r) => r.name === name && _isOwnershipRecord(r))?.target

const _ensureRaw = (
  { dns, zone, name, target, kind, existing }: {
    readonly dns: HetznerDns
    readonly zone: string
    readonly name: string
    readonly target: string
    readonly kind: DnsRecordKind
    readonly existing: HetznerRRset | undefined
  }
): Effect.Effect<void, DnsError> =>
  existing !== undefined && existing.records[0]?.value === target
    ? Effect.void
    : _wrap(zone, name, dns.putRRset(zone, name, kind, { ttl: existing?.ttl ?? _DEFAULT_TTL, records: [{ value: target }] }))

/**
 * Drops the rrsets left at this name by a *previous* kind of the same record —
 * a target that changes from a hostname to an address turns a CNAME into an A,
 * and RFC 1034 §3.6.2 forbids the two coexisting. Only ever reached past the
 * ownership guard below, so every rrset it deletes is one this module wrote.
 */
const _deleteStaleKinds = (
  { dns, zone, name, kind, existingOther }: {
    readonly dns: HetznerDns
    readonly zone: string
    readonly name: string
    readonly kind: DnsRecordKind
    readonly existingOther: ReadonlyArray<HetznerRRset>
  }
): Effect.Effect<void, DnsError> =>
  Effect.forEach(existingOther.filter((r) => r.type !== kind), (r) => _wrap(zone, name, dns.deleteRRset(zone, name, r.type)), {
    discard: true
  })

// kumulo: never mutate a record this module doesn't own: *any* pre-existing
// non-TXT rrset at this name (regardless of its kind), and any existing TXT
// ownership rrset for a *different* tag, are only touched (or claimed via a
// fresh TXT ownership rrset) when they don't exist at all — same contract as
// dns-ovh's `_ensurePair` (D2: single-value rrsets only, no merge).
const _ensurePair = (
  { dns, zone, name, target, ownerTarget }:
    { readonly dns: HetznerDns; readonly zone: string; readonly name: string; readonly target: string; readonly ownerTarget: string | undefined }
): Effect.Effect<void, DnsError> =>
  Effect.gen(function*() {
    const kind = recordKind(target)
    const existing = yield* rrsetsAt({ dns, zone, name })
    const existingOther = existing.filter((r) => r.type !== "TXT")
    const existingOwnerTxt = existing.find((r) => r.type === "TXT" && ownerTagOf(r.records[0]?.value ?? "") !== undefined)
    const foreignOwnerTxt = existingOwnerTxt !== undefined && existingOwnerTxt.records[0]?.value !== ownerTarget
    if (foreignOwnerTxt || (existingOther.length > 0 && existingOwnerTxt === undefined)) {
      return yield* Effect.fail(new ResourceConflict({ kind: "dns-record", ref: `${zone}/${name}` }))
    }
    if (ownerTarget !== undefined) {
      yield* _ensureRaw({ dns, zone, name, target: ownerTarget, kind: "TXT", existing: existingOwnerTxt })
    }
    yield* _deleteStaleKinds({ dns, zone, name, kind, existingOther })
    const existingSame = existingOther.find((r) => r.type === kind)
    yield* _ensureRaw({ dns, zone, name, target, kind, existing: existingSame })
  })

/** Create-or-update every desired record to its target (idempotent — no-op if already correct, N1). */
export const ensureRecords = (dns: HetznerDns) =>
  (zone: string, records: ReadonlyArray<DesiredRecord>): Effect.Effect<void, DnsError> =>
    Effect.gen(function*() {
      const rest = records.filter((r) => !_isOwnershipRecord(r))
      const pairedNames = new Set(rest.map((r) => r.name))
      const orphanTxt = records.filter((r) => _isOwnershipRecord(r) && !pairedNames.has(r.name))
      for (const record of rest) {
        const ownerTarget = _ownerTargetFor(records, record.name)
        yield* _ensurePair({ dns, zone, name: record.name, target: record.target, ownerTarget })
      }
      for (const record of orphanTxt) {
        const existing = yield* rrsetsAt({ dns, zone, name: record.name })
        yield* _ensureRaw({ dns, zone, name: record.name, target: record.target, kind: "TXT", existing: existing.find((r) => r.type === "TXT") })
      }
    })

const _ownedNames = (rrsets: ReadonlyArray<HetznerRRset>, tag: ClusterTag): ReadonlySet<string> =>
  new Set(rrsets.filter((r) => r.type === "TXT" && ownerTagOf(r.records[0]?.value ?? "") === tag).map((r) => r.name))

/** Deletes only rrsets at names this cluster's TXT ownership rrset covers. */
export const removeClusterRecords = (dns: HetznerDns) =>
  (zone: string, tag: ClusterTag): Effect.Effect<void, DnsError> =>
    Effect.gen(function*() {
      const all = yield* rrsetsAt({ dns, zone })
      const owned = _ownedNames(all, tag)
      const toDelete = all.filter((r) => owned.has(r.name))
      for (const record of toDelete) {
        yield* _wrap(zone, record.name, dns.deleteRRset(zone, record.name, record.type))
      }
    })

export const makeHetznerDnsProvider = (dns: HetznerDns) => ({
  ensureRecords: ensureRecords(dns),
  removeClusterRecords: removeClusterRecords(dns)
})

export const hetznerDnsProviderLive = (dns: HetznerDns) => Layer.succeed(DnsProvider, makeHetznerDnsProvider(dns))
