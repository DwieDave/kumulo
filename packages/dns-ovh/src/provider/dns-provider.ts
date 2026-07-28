import { Effect, Layer } from "effect"
import type { SchemaError } from "effect/Schema"
import type * as HttpClientError from "effect/unstable/http/HttpClientError"
import { DnsProvider, ownerTagOf, recordKind, ResourceConflict } from "@kumulo/core"
import type { ClusterTag, DesiredRecord, DnsError } from "@kumulo/core"
import type { Dns, Domain_zone_RecordTypeEnum } from "../generated/client.ts"
import { toDnsError } from "./errors.ts"
import { recordsAt } from "./existing.ts"
import type { ZoneRecord } from "./existing.ts"

const _wrap = (
  zone: string,
  name: string,
  self: Effect.Effect<unknown, HttpClientError.HttpClientError | SchemaError>
): Effect.Effect<void, DnsError> => Effect.asVoid(Effect.mapError(self, (cause) => toDnsError({ cause, zone, name })))

const _isOwnershipRecord = (record: DesiredRecord): boolean => ownerTagOf(record.target) !== undefined

/** Same-name TXT ownership record within this `ensureRecords` batch, if the caller included one. */
const _ownerTargetFor = (records: ReadonlyArray<DesiredRecord>, name: string): string | undefined =>
  records.find((r) => r.name === name && _isOwnershipRecord(r))?.target

const _ensureRaw = (
  { dns, zone, name, target, kind, existingRecord }: {
    readonly dns: Dns
    readonly zone: string
    readonly name: string
    readonly target: string
    readonly kind: Domain_zone_RecordTypeEnum
    readonly existingRecord: { readonly id: number; readonly target: string } | undefined
  }
): Effect.Effect<void, DnsError> =>
  !existingRecord
    ? _wrap(zone, name, dns.createRecord(zone, { payload: { fieldType: kind, subDomain: name, target } }))
    : existingRecord.target !== target
    ? _wrap(zone, name, dns.editRecord(zone, String(existingRecord.id), { payload: { target } }))
    : Effect.void

/**
 * Drops the records left at this name by a *previous* kind of the same record —
 * a target that changes from a hostname to an address turns a CNAME into an A,
 * and RFC 1034 §3.6.2 forbids the two coexisting. Only ever reached past the
 * ownership guard below, so every record it deletes is one this module wrote.
 */
const _deleteStaleKinds = (
  { dns, zone, name, kind, existingOther }: {
    readonly dns: Dns
    readonly zone: string
    readonly name: string
    readonly kind: Domain_zone_RecordTypeEnum
    readonly existingOther: ReadonlyArray<ZoneRecord>
  }
): Effect.Effect<void, DnsError> =>
  Effect.forEach(
    existingOther.filter((r) => r.fieldType !== kind),
    (r) => _wrap(zone, name, dns.deleteRecord(zone, String(r.id), undefined)),
    { discard: true }
  )

// kumulo: never mutate a record this module doesn't own: *any* pre-existing
// non-TXT record at this name (regardless of its kind — a foreign CNAME
// blocks a desired A record just as much as a foreign A does), and any
// existing TXT ownership record for a *different* tag, are only touched (or
// claimed via a fresh TXT ownership record) when they don't exist at all.
// A foreign ownership TXT is never edited to this batch's value (no hijack).
const _ensurePair = (
  { dns, zone, name, target, ownerTarget }:
    { readonly dns: Dns; readonly zone: string; readonly name: string; readonly target: string; readonly ownerTarget: string | undefined }
): Effect.Effect<void, DnsError> =>
  Effect.gen(function*() {
    const kind = recordKind(target)
    const existing = yield* recordsAt({ dns, zone, subDomain: name })
    const existingOther = existing.filter((r) => r.fieldType !== "TXT")
    const existingOwnerTxt = existing.find((r) => r.fieldType === "TXT" && ownerTagOf(r.target) !== undefined)
    const foreignOwnerTxt = existingOwnerTxt !== undefined && existingOwnerTxt.target !== ownerTarget
    if (foreignOwnerTxt || (existingOther.length > 0 && existingOwnerTxt === undefined)) {
      return yield* Effect.fail(new ResourceConflict({ kind: "dns-record", ref: `${zone}/${name}` }))
    }
    if (ownerTarget !== undefined) {
      yield* _ensureRaw({ dns, zone, name, target: ownerTarget, kind: "TXT", existingRecord: existingOwnerTxt })
    }
    yield* _deleteStaleKinds({ dns, zone, name, kind, existingOther })
    const existingSame = existingOther.find((r) => r.fieldType === kind)
    yield* _ensureRaw({ dns, zone, name, target, kind, existingRecord: existingSame })
  })

/** Create-or-update every desired record to its target, then refresh the zone once. */
export const ensureRecords = (dns: Dns) =>
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
        const existing = yield* recordsAt({ dns, zone, subDomain: record.name })
        yield* _ensureRaw({
          dns,
          zone,
          name: record.name,
          target: record.target,
          kind: "TXT",
          existingRecord: existing.find((r) => r.fieldType === "TXT")
        })
      }
      if (records.length > 0) yield* _wrap(zone, "*", dns.refreshZone(zone, undefined))
    })

const _ownedSubDomains = (records: ReadonlyArray<{ readonly fieldType: string; readonly subDomain: string; readonly target: string }>, tag: ClusterTag) =>
  new Set(records.filter((r) => r.fieldType === "TXT" && ownerTagOf(r.target) === tag).map((r) => r.subDomain))

/** Deletes only records at subdomains this cluster's TXT ownership record covers. */
export const removeClusterRecords = (dns: Dns) =>
  (zone: string, tag: ClusterTag): Effect.Effect<void, DnsError> =>
    Effect.gen(function*() {
      const all = yield* recordsAt({ dns, zone })
      const owned = _ownedSubDomains(all, tag)
      const toDelete = all.filter((r) => owned.has(r.subDomain))
      for (const record of toDelete) {
        yield* _wrap(zone, record.subDomain, dns.deleteRecord(zone, String(record.id), undefined))
      }
      if (toDelete.length > 0) yield* _wrap(zone, "*", dns.refreshZone(zone, undefined))
    })

export const makeOvhDnsProvider = (dns: Dns) => ({
  ensureRecords: ensureRecords(dns),
  removeClusterRecords: removeClusterRecords(dns)
})

export const ovhDnsProviderLive = (dns: Dns) => Layer.succeed(DnsProvider, makeOvhDnsProvider(dns))
