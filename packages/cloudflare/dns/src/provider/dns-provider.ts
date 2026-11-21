import { Effect, Layer, Option, Schema } from "effect"
import { DnsProvider, ProviderApiError, ResourceNotFound, reconcileDns } from "@kumulo/core"
import type { DnsAdapter, DnsError, ZoneRecord } from "@kumulo/core"
import { DnsRecordType } from "../client/cloudflare-dns.ts"
import type { CloudflareDnsClient, DnsRecord, DnsRecordInput } from "../client/cloudflare-dns.ts"

const _APEX = "@"

// Appended to the value of a proxied record when it is read, so an owned record someone
// switched to proxied compares unequal to its target and is rewritten with proxied: false.
const _PROXIED_MARK = " (proxied)"

export interface CloudflareDnsProviderOptions {
  readonly dns: CloudflareDnsClient
  readonly ttl?: number | undefined
}

const _normalize = ({ name, zone }: { readonly name: string; readonly zone: string }): string => {
  const lowered = name.toLowerCase()
  const apex = zone.toLowerCase()

  if (lowered === "" || lowered === _APEX || lowered === apex) return _APEX

  return lowered.endsWith(`.${apex}`) ? lowered.slice(0, lowered.length - apex.length - 1) : lowered
}

// Cloudflare takes and returns full record names.
const _fullName = ({ name, zone }: { readonly name: string; readonly zone: string }): string => {
  const relative = _normalize({ name, zone })

  return relative === _APEX ? zone.toLowerCase() : `${relative}.${zone.toLowerCase()}`
}

const _unquote = (data: string): string =>
  data.length >= 2 && data.startsWith("\"") && data.endsWith("\"") ? data.slice(1, -1) : data

// The spec asks for TXT content as quoted RFC 1035 character strings.
const _quote = (data: string): string => data.startsWith("\"") && data.endsWith("\"") && data.length >= 2 ? data : `"${data}"`

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
  id: record.id,
  name: record.name,
  type: record.type,
  value: record.proxied === true ? `${record.content ?? ""}${_PROXIED_MARK}` : record.content ?? "",
  ttl: record.ttl ?? 1
})

const _unsupported = (record: ZoneRecord) =>
  new ProviderApiError({ operation: "ensureRecords", status: 422, body: `unsupported record type ${record.type} at ${record.name}` })

const _toInput = ({ record, zone }: { readonly zone: string; readonly record: ZoneRecord }): Effect.Effect<DnsRecordInput, DnsError> => {
  if (!_isRecordType(record.type)) return Effect.fail(_unsupported(record))

  const name = _fullName({ name: record.name, zone })

  return Effect.succeed(
    record.type === "TXT"
      ? { type: record.type, name, content: _quote(record.value), ttl: record.ttl }
      : { type: record.type, name, content: record.value, ttl: record.ttl, proxied: false }
  )
}

const _requireId = (record: ZoneRecord): Effect.Effect<string, DnsError> =>
  record.id === undefined
    ? Effect.fail(new ProviderApiError({ operation: "cloudflare record id", status: 0, body: `record ${record.name} has no id` }))
    : Effect.succeed(record.id)

export const zoneNotVisible = (zone: string): ResourceNotFound =>
  new ResourceNotFound({
    kind: "dns-zone",
    ref: `${zone} (not visible to this Cloudflare token: give CLOUDFLARE_API_TOKEN Zone:Read and DNS:Edit on the zone, or check the zone is in the token's account)`
  })

export const makeCloudflareDnsAdapter = ({ dns, ttl }: CloudflareDnsProviderOptions): DnsAdapter => {
  const zoneIds = new Map<string, string>()

  const zoneIdOf = (zone: string): Effect.Effect<string, DnsError> => {
    const key = zone.toLowerCase()
    const known = zoneIds.get(key)

    if (known !== undefined) return Effect.succeed(known)

    return dns.findZone({ name: zone }).pipe(
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(zoneNotVisible(zone)),
        onSome: (found) =>
          Effect.sync(() => {
            zoneIds.set(key, found.id)

            return found.id
          })
      }))
    )
  }

  return {
    ttl,
    list: (zone) =>
      zoneIdOf(zone).pipe(
        Effect.flatMap((zoneId) => dns.listRecords({ zone, zoneId })),
        Effect.map((records) => records.map(_toZoneRecord))
      ),
    create: ({ record, zone }) =>
      Effect.flatMap(
        Effect.all([zoneIdOf(zone), _toInput({ record, zone })]),
        ([zoneId, input]) => Effect.asVoid(dns.createRecord({ zone, zoneId, record: input }))
      ),
    update: ({ existing, record, zone }) =>
      Effect.flatMap(
        Effect.all([zoneIdOf(zone), _requireId(existing), _toInput({ record, zone })]),
        ([zoneId, recordId, input]) => Effect.asVoid(dns.replaceRecord({ zone, zoneId, recordId, record: input }))
      ),
    delete: ({ record, zone }) =>
      Effect.flatMap(
        Effect.all([zoneIdOf(zone), _requireId(record)]),
        ([zoneId, recordId]) => dns.deleteRecord({ zone, zoneId, recordId })
      ),
    normalize: _normalize,
    canonical: _canonical
  }
}

export const makeCloudflareDnsProvider = (options: CloudflareDnsProviderOptions) => reconcileDns(makeCloudflareDnsAdapter(options))

export const cloudflareDnsProviderLive = (options: CloudflareDnsProviderOptions) =>
  Layer.succeed(DnsProvider, makeCloudflareDnsProvider(options))
