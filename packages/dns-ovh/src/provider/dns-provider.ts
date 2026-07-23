import { Effect, Layer } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import { DnsProvider, ResourceConflict } from "@kumulo/core"
import type { ClusterTag, DesiredRecord, DnsError } from "@kumulo/core"
import type { Dns, Domain_zone_RecordTypeEnum } from "../generated/client.ts"
import { toDnsError } from "./errors.ts"
import { recordsAt } from "./existing.ts"
import { ownerTagOf, recordKind } from "./ownership.ts"

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

// FR-7.2 — never mutate a record this module doesn't own: an existing
// non-TXT record at this name is only touched (or claimed via a fresh TXT
// ownership record) when a sibling TXT record already carries the exact
// ownership value this batch expects, or there is no pre-existing record.
const _ensurePair = (
  { dns, zone, name, target, ownerTarget }:
    { readonly dns: Dns; readonly zone: string; readonly name: string; readonly target: string; readonly ownerTarget: string | undefined }
): Effect.Effect<void, DnsError> =>
  Effect.gen(function*() {
    const kind = recordKind(target)
    const existing = yield* recordsAt({ dns, zone, subDomain: name })
    const existingSame = existing.find((r) => r.fieldType === kind)
    const existingOwnerTxt = existing.find((r) => r.fieldType === "TXT" && ownerTagOf(r.target) !== undefined)
    if (existingSame && existingOwnerTxt?.target !== ownerTarget) {
      return yield* Effect.fail(new ResourceConflict({ kind: "dns-record", ref: `${zone}/${name}` }))
    }
    if (ownerTarget !== undefined) {
      yield* _ensureRaw({ dns, zone, name, target: ownerTarget, kind: "TXT", existingRecord: existingOwnerTxt })
    }
    yield* _ensureRaw({ dns, zone, name, target, kind, existingRecord: existingSame })
  })

/** FR-7.2/7.3 — create-or-update every desired record to its target, then refresh the zone once. */
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

/** FR-7.3 — deletes only records at subdomains this cluster's TXT ownership record covers. */
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
