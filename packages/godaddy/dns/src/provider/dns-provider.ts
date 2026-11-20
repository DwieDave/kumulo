import { Effect, Layer, Option, Schema } from "effect"
import { DnsProvider, ProviderApiError, ownerTagOf, recordKind, reconcileDns } from "@kumulo/core"
import type { DesiredRecord, DnsAdapter, DnsError, ZoneRecord } from "@kumulo/core"
import { DnsRecordType } from "../client/godaddy-dns.ts"
import type { DnsRecord, GodaddyDnsClient } from "../client/godaddy-dns.ts"

const _APEX = "@"

export interface GodaddyDnsProviderOptions {
  readonly dns: GodaddyDnsClient
  readonly ttl?: number | undefined
}

const _normalize = ({ name, zone }: { readonly name: string; readonly zone: string }): string => {
  const lowered = name.toLowerCase()
  const apex = zone.toLowerCase()

  if (lowered === "" || lowered === _APEX || lowered === apex) return _APEX

  return lowered.endsWith(`.${apex}`) ? lowered.slice(0, lowered.length - apex.length - 1) : lowered
}

const _unquote = (data: string): string =>
  data.length >= 2 && data.startsWith("\"") && data.endsWith("\"") ? data.slice(1, -1) : data

const _canonicalIpv6 = (data: string): string => {
  const url = Option.liftThrowable(() => new URL(`http://[${data}]`))()

  return Option.match(url, { onNone: () => data.toLowerCase(), onSome: (u) => u.hostname })
}

const _canonical = ({ type, value }: { readonly type: string; readonly value: string }): string => {
  const bare = _unquote(value)

  if (type === "CNAME") return bare.toLowerCase().replace(/\.$/, "")

  return type === "AAAA" ? _canonicalIpv6(bare) : bare
}

const _isRecordType = Schema.is(DnsRecordType)

const _toZoneRecord = (record: DnsRecord): ZoneRecord => ({
  id: record.recordId,
  name: record.name,
  type: record.type,
  value: record.data,
  ttl: record.ttl
})

const _unsupported = (record: ZoneRecord) =>
  new ProviderApiError({
    operation: "ensureRecords",
    status: 422,
    body: `unsupported record type ${record.type} at ${record.name}`
  })

const _toInput = (record: ZoneRecord) =>
  _isRecordType(record.type)
    ? Effect.succeed({ name: record.name, type: record.type, data: record.value, ttl: record.ttl })
    : Effect.fail(_unsupported(record))

const _requireId = (record: ZoneRecord): Effect.Effect<string, DnsError> =>
  record.id === undefined
    ? Effect.fail(new ProviderApiError({ operation: "godaddy record id", status: 0, body: `record ${record.name} has no id` }))
    : Effect.succeed(record.id)

export const makeGodaddyDnsAdapter = ({ dns, ttl }: GodaddyDnsProviderOptions): DnsAdapter => ({
  ttl,
  list: (zone) => Effect.map(dns.listRecords({ zone }), (records) => records.map(_toZoneRecord)),
  create: ({ zone, record }) =>
    Effect.flatMap(_toInput(record), (input) => Effect.asVoid(dns.createRecord({ zone, record: input }))),
  update: ({ zone, existing, record }) =>
    Effect.flatMap(
      Effect.all([_requireId(existing), _toInput(record)]),
      ([recordId, input]) => Effect.asVoid(dns.replaceRecord({ zone, recordId, record: input }))
    ),
  delete: ({ zone, record }) => Effect.flatMap(_requireId(record), (recordId) => dns.deleteRecord({ zone, recordId })),
  normalize: _normalize,
  canonical: _canonical
})

const _isOwnershipRecord = (record: DesiredRecord): boolean => ownerTagOf(record.target) !== undefined

const _apexCname = ({ records, zone }: { readonly records: ReadonlyArray<DesiredRecord>; readonly zone: string }) =>
  records.find((r) => !_isOwnershipRecord(r) && _normalize({ name: r.name, zone }) === _APEX && recordKind(r.target) === "CNAME")

const _rejectApexCname = ({ records, zone }: { readonly records: ReadonlyArray<DesiredRecord>; readonly zone: string }) =>
  Option.match(Option.fromNullishOr(_apexCname({ records, zone })), {
    onNone: () => Effect.void,
    onSome: (record) =>
      Effect.fail(
        new ProviderApiError({
          operation: "ensureRecords",
          status: 422,
          body: `GoDaddy rejects a CNAME at the zone apex: ${zone} would point at ${record.target}; target an IP address instead`
        })
      )
  })

export const makeGodaddyDnsProvider = (options: GodaddyDnsProviderOptions) => {
  const reconciler = reconcileDns(makeGodaddyDnsAdapter(options))

  return {
    ensureRecords: (zone: string, records: ReadonlyArray<DesiredRecord>): Effect.Effect<void, DnsError> =>
      Effect.andThen(_rejectApexCname({ records, zone }), reconciler.ensureRecords(zone, records)),
    removeClusterRecords: reconciler.removeClusterRecords
  }
}

export const godaddyDnsProviderLive = (options: GodaddyDnsProviderOptions) =>
  Layer.succeed(DnsProvider, makeGodaddyDnsProvider(options))
