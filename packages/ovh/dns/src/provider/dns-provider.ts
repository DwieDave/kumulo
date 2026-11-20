import { Effect, Layer, Option, Ref, Schema } from "effect"
import type { SchemaError } from "effect/Schema"
import type * as HttpClientError from "effect/http/HttpClientError"
import { DnsProvider, ProviderApiError, reconcileDns } from "@kumulo/core"
import type { ClusterTag, DesiredRecord, DnsAdapter, DnsError, ZoneRecord } from "@kumulo/core"
import { Domain_zone_RecordTypeEnum } from "../generated/client.ts"
import type { Dns } from "../generated/client.ts"
import { mapDnsError } from "../errors.ts"

const _APEX = "@"

const _DEFAULT_TTL = 600

const _isRecordType = Schema.is(Domain_zone_RecordTypeEnum)

const _normalize = ({ name, zone }: { readonly name: string; readonly zone: string }): string => {
  const lowered = name.toLowerCase().replace(/\.$/, "")
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

// OVH addresses the apex with an empty subDomain
const _subDomainOf = (name: string): string => name === _APEX ? "" : name

const _toZoneRecord = (raw: { id?: number; fieldType?: string; subDomain?: string | null; target?: string; ttl?: number | null }): ZoneRecord => ({
  id: raw.id === undefined ? undefined : String(raw.id),
  name: raw.subDomain ?? "",
  type: raw.fieldType ?? "",
  value: raw.target ?? "",
  ttl: raw.ttl ?? 0
})

const _requireId = (record: ZoneRecord): Effect.Effect<string, DnsError> =>
  record.id === undefined
    ? Effect.fail(new ProviderApiError({ operation: "ovh record id", status: 0, body: `record ${record.name} has no id` }))
    : Effect.succeed(record.id)

const _requireType = (record: ZoneRecord) =>
  _isRecordType(record.type)
    ? Effect.succeed(record.type)
    : Effect.fail(
      new ProviderApiError({ operation: "ensureRecords", status: 422, body: `unsupported record type ${record.type} at ${record.name}` })
    )

const _list = ({ dns, zone }: { readonly dns: Dns; readonly zone: string }): Effect.Effect<ReadonlyArray<ZoneRecord>, DnsError> =>
  Effect.gen(function*() {
    const ids = yield* mapDnsError({ self: dns.getRecords(zone, undefined), zone, name: "*" })

    // the transport caps in-flight requests, this only bounds the fiber fan-out
    const raws = yield* Effect.forEach(
      ids,
      (id) => mapDnsError({ self: dns.getRecord(zone, String(id), undefined), zone, name: String(id) }),
      { concurrency: 4 }
    )

    return raws.map(_toZoneRecord)
  })

// `touched` flips on every write so the zone is refreshed once, and only when something changed
const _adapter = ({ dns, touched }: { readonly dns: Dns; readonly touched: Ref.Ref<boolean> }): DnsAdapter => {
  const wrap = <A>(
    { self, zone, record }: {
      readonly self: Effect.Effect<A, HttpClientError.HttpClientError | SchemaError>
      readonly zone: string
      readonly record: ZoneRecord
    }
  ) => Effect.andThen(Ref.set(touched, true), mapDnsError({ self, zone, name: record.name }))

  return {
    ttl: _DEFAULT_TTL,
    list: (zone) => _list({ dns, zone }),
    create: ({ zone, record }) =>
      Effect.flatMap(_requireType(record), (fieldType) =>
        Effect.asVoid(wrap({
          self: dns.createRecord(zone, {
            payload: { fieldType, subDomain: _subDomainOf(record.name), target: record.value, ttl: record.ttl }
          }),
          zone,
          record
        }))),
    update: ({ zone, existing, record }) =>
      Effect.flatMap(_requireId(existing), (id) =>
        wrap({ self: dns.editRecord(zone, id, { payload: { target: record.value, ttl: record.ttl } }), zone, record })),
    delete: ({ zone, record }) =>
      Effect.flatMap(_requireId(record), (id) => wrap({ self: dns.deleteRecord(zone, id, undefined), zone, record })),
    normalize: _normalize,
    canonical: _canonical
  }
}

const _withRefresh = <A>(
  { dns, zone, run }: {
    readonly dns: Dns
    readonly zone: string
    readonly run: (adapter: DnsAdapter) => Effect.Effect<A, DnsError>
  }
): Effect.Effect<A, DnsError> =>
  Effect.gen(function*() {
    const touched = yield* Ref.make(false)
    const result = yield* run(_adapter({ dns, touched }))

    if (yield* Ref.get(touched)) yield* mapDnsError({ self: dns.refreshZone(zone, undefined), zone, name: "*" })

    return result
  })

export const makeOvhDnsProvider = (dns: Dns) => ({
  ensureRecords: (zone: string, records: ReadonlyArray<DesiredRecord>) =>
    _withRefresh({ dns, zone, run: (adapter) => reconcileDns(adapter).ensureRecords(zone, records) }),
  removeClusterRecords: (zone: string, tag: ClusterTag) =>
    _withRefresh({ dns, zone, run: (adapter) => reconcileDns(adapter).removeClusterRecords(zone, tag) })
})

export const ovhDnsProviderLive = (dns: Dns) => Layer.succeed(DnsProvider, makeOvhDnsProvider(dns))
