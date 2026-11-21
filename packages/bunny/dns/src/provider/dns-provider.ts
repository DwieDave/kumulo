import { Effect, Layer, Option, Schema } from "effect"
import { DnsProvider, ownershipName, ownerTagOf, ProviderApiError, reconcileDns, ResourceNotFound } from "@kumulo/core"
import type { ClusterTag, DesiredRecord, DnsAdapter, DnsError, ZoneRecord } from "@kumulo/core"
import { bunnyCapabilityAsApiError, BunnyDnsRecordType } from "@kumulo/bunny"
import type { BunnyDnsClient, BunnyDnsRecord, BunnyDnsRecordInput, BunnyError } from "@kumulo/bunny"

const _DEFAULT_TTL = 300

const _PULLZONE_PREFIX = "pullzone:"

export interface BunnyDnsProviderOptions {
  readonly dns: BunnyDnsClient
  readonly ttl?: number | undefined
  /**
   * Resolves a CDN system hostname (for example `my-zone.b-cdn.net`) to its pull zone id.
   * When it returns an id for a target at the zone apex, the record is written as type
   * PullZone instead of a CNAME (a CNAME is not allowed at the apex).
   */
  readonly pullZoneIdFor?: (hostname: string) => number | undefined
}

const _isRecordType = Schema.is(BunnyDnsRecordType)

const _wrap = <A>(self: Effect.Effect<A, BunnyError>): Effect.Effect<A, DnsError> =>
  Effect.mapError(self, bunnyCapabilityAsApiError)

const _normalize = ({ name, zone }: { readonly name: string; readonly zone: string }): string => {
  const lowered = name.toLowerCase()
  const apex = zone.toLowerCase()

  if (lowered === "" || lowered === "@" || lowered === apex) return ""

  return lowered.endsWith(`.${apex}`) ? lowered.slice(0, lowered.length - apex.length - 1) : lowered
}

const _unquote = (data: string): string =>
  data.length >= 2 && data.startsWith("\"") && data.endsWith("\"") ? data.slice(1, -1) : data

const _canonicalIpv6 = (data: string): string => {
  const url = Option.liftThrowable(() => new URL(`http://[${data}]`))()

  return Option.match(url, { onNone: () => data.toLowerCase(), onSome: (u) => u.hostname })
}

// A PullZone record carries no hostname, only an id; list() renders it as a CNAME to `pullzone:<id>`.
const _toZoneRecord = (record: BunnyDnsRecord): ZoneRecord => {
  const pullZoneId = record.PullZoneId ?? record.AcceleratedPullZoneId

  return record.Type === "PullZone"
    ? { id: String(record.Id), name: record.Name ?? "", type: "CNAME", value: `${_PULLZONE_PREFIX}${pullZoneId}`, ttl: record.Ttl }
    : { id: String(record.Id), name: record.Name ?? "", type: record.Type, value: record.Value ?? "", ttl: record.Ttl }
}

const _commentFor = (ownerTarget: string): string | undefined => {
  const tag = ownerTagOf(ownerTarget)

  return tag === undefined ? undefined : `managed by kumulo (${tag})`
}

const _unsupported = (record: ZoneRecord) =>
  Effect.fail(new ProviderApiError({ operation: "dns-record", status: 400, body: `unsupported record type ${record.type}` }))

const _adapter = (
  { comments, options }: { readonly options: BunnyDnsProviderOptions; readonly comments: ReadonlyMap<string, string> }
): DnsAdapter => {
  const { dns } = options
  const zoneIds = new Map<string, number>()

  const zoneIdOf = (zone: string): Effect.Effect<number, DnsError> => {
    const cached = zoneIds.get(zone)

    if (cached !== undefined) return Effect.succeed(cached)

    return _wrap(dns.findZone({ domain: zone })).pipe(
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(new ResourceNotFound({ kind: "dns-zone", ref: zone })),
        onSome: (found) => Effect.sync(() => (zoneIds.set(zone, found.Id), found.Id))
      }))
    )
  }

  const inputOf = (record: ZoneRecord): BunnyDnsRecordInput | undefined => {
    if (!_isRecordType(record.type)) return undefined

    const pullZoneId = record.type === "CNAME" && record.name === "" ? options.pullZoneIdFor?.(record.value) : undefined
    const comment = comments.get(record.name)

    const base: BunnyDnsRecordInput = {
      Name: record.name,
      Type: pullZoneId === undefined ? record.type : "PullZone",
      Value: pullZoneId === undefined ? record.value : "",
      Ttl: record.ttl
    }

    const withComment = comment === undefined ? base : { ...base, Comment: comment }

    return pullZoneId === undefined ? withComment : { ...withComment, PullZoneId: pullZoneId }
  }

  return {
    ttl: options.ttl ?? _DEFAULT_TTL,
    list: (zone) =>
      zoneIdOf(zone).pipe(
        Effect.flatMap((zoneId) => _wrap(dns.listRecords({ zoneId }))),
        Effect.map((records) => records.map(_toZoneRecord))
      ),
    create: ({ record, zone }) => {
      const input = inputOf(record)

      return input === undefined
        ? _unsupported(record)
        : zoneIdOf(zone).pipe(Effect.flatMap((zoneId) => _wrap(dns.addRecord({ zoneId, record: input }))), Effect.asVoid)
    },
    update: ({ existing, record, zone }) => {
      const input = inputOf(record)

      return input === undefined
        ? _unsupported(record)
        : zoneIdOf(zone).pipe(
          Effect.flatMap((zoneId) => _wrap(dns.updateRecord({ zoneId, recordId: Number(existing.id), record: input })))
        )
    },
    delete: ({ record, zone }) =>
      zoneIdOf(zone).pipe(Effect.flatMap((zoneId) => _wrap(dns.deleteRecord({ zoneId, recordId: Number(record.id) })))),
    normalize: _normalize,
    canonical: ({ type, value }) => {
      const bare = type === "TXT" ? _unquote(value) : value

      if (type === "AAAA") return _canonicalIpv6(bare)

      if (type !== "CNAME" || bare.startsWith(_PULLZONE_PREFIX)) return bare

      const host = bare.toLowerCase().replace(/\.$/, "")
      const pullZoneId = options.pullZoneIdFor?.(host)

      return pullZoneId === undefined ? host : `${_PULLZONE_PREFIX}${pullZoneId}`
    }
  }
}

const _commentsFor = (
  { records, zone }: { readonly zone: string; readonly records: ReadonlyArray<DesiredRecord> }
): ReadonlyMap<string, string> =>
  new Map(records.flatMap((record) => {
    const comment = _commentFor(record.target)
    const name = _normalize({ name: record.name, zone })

    // the ownership TXT sits at _kumulo.<name> and carries the same comment as the records it owns
    return comment === undefined ? [] : [[name, comment] as const, [ownershipName({ name, apexKey: "" }), comment] as const]
  }))

export const makeBunnyDnsProvider = (options: BunnyDnsProviderOptions) => ({
  // the managed-by comment depends on the records being applied, so the adapter is built per call
  ensureRecords: (zone: string, records: ReadonlyArray<DesiredRecord>): Effect.Effect<void, DnsError> =>
    records.length === 0
      ? Effect.void
      : reconcileDns(_adapter({ options, comments: _commentsFor({ zone, records }) })).ensureRecords(zone, records),
  removeClusterRecords: (zone: string, tag: ClusterTag): Effect.Effect<void, DnsError> =>
    reconcileDns(_adapter({ options, comments: new Map() })).removeClusterRecords(zone, tag)
})

export const bunnyDnsProviderLive = (options: BunnyDnsProviderOptions) =>
  Layer.succeed(DnsProvider, makeBunnyDnsProvider(options))
