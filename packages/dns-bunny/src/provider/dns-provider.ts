import { Effect, Layer, Option } from "effect"
import { DnsProvider, ResourceConflict, ResourceNotFound, ownerTagOf, recordKind } from "@kumulo/core"
import type { ClusterTag, DesiredRecord, DnsError } from "@kumulo/core"
import type { BunnyDnsClient, BunnyDnsRecord, BunnyDnsRecordInput, BunnyDnsRecordType, BunnyError } from "@kumulo/bunny"
import { toDnsError } from "./errors.ts"

const _DEFAULT_TTL = 300

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

type _WireKind = BunnyDnsRecordType

const _wrap = <A>(self: Effect.Effect<A, BunnyError>): Effect.Effect<A, DnsError> => Effect.mapError(self, toDnsError)

const _normalize = ({ name, zone }: { readonly name: string; readonly zone: string }): string => {
  const lowered = name.toLowerCase()
  const apex = zone.toLowerCase()

  if (lowered === "" || lowered === "@" || lowered === apex) return ""

  return lowered.endsWith(`.${apex}`) ? lowered.slice(0, lowered.length - apex.length - 1) : lowered
}

const _nameOf = (zone: string) => (record: BunnyDnsRecord): string => _normalize({ name: record.Name ?? "", zone })

const _valueOf = (record: BunnyDnsRecord): string => record.Value ?? ""

const _isOwnerTxt = (record: BunnyDnsRecord): boolean => record.Type === "TXT" && ownerTagOf(_valueOf(record)) !== undefined

const _WRITTEN_KINDS: ReadonlyArray<string> = ["A", "AAAA", "CNAME", "PullZone"]

const _isWritten = (record: BunnyDnsRecord): boolean => _WRITTEN_KINDS.includes(record.Type)

const _isOwnershipRecord = (record: DesiredRecord): boolean => ownerTagOf(record.target) !== undefined

const _ownerTargetFor = ({ name, records }: { readonly records: ReadonlyArray<DesiredRecord>; readonly name: string }): string | undefined =>
  records.find((r) => r.name === name && _isOwnershipRecord(r))?.target

const _inputOf = (
  { comment, name, pullZoneId, ttl, type, value }: {
    readonly name: string
    readonly type: _WireKind
    readonly value: string
    readonly ttl: number
    readonly comment: string | undefined
    readonly pullZoneId: number | undefined
  }
): BunnyDnsRecordInput => {
  const input: BunnyDnsRecordInput = { Name: name, Type: type, Value: pullZoneId === undefined ? value : "", Ttl: ttl }
  const withComment = comment === undefined ? input : { ...input, Comment: comment }

  return pullZoneId === undefined ? withComment : { ...withComment, PullZoneId: pullZoneId }
}

const _commentFor = (ownerTarget: string | undefined): string | undefined => {
  const tag = ownerTarget === undefined ? undefined : ownerTagOf(ownerTarget)

  return tag === undefined ? undefined : `managed by kumulo (${tag})`
}

const _matches = (
  { existing, pullZoneId, value }: { readonly existing: BunnyDnsRecord; readonly value: string; readonly pullZoneId: number | undefined }
): boolean => pullZoneId === undefined ? _valueOf(existing) === value : existing.Type === "PullZone" && (existing.AcceleratedPullZoneId === pullZoneId || existing.PullZoneId === pullZoneId)

const _ensureRaw = (
  { comment, dns, existing, name, pullZoneId, ttl, type, value, zoneId }: {
    readonly ttl: number
    readonly dns: BunnyDnsClient
    readonly zoneId: number
    readonly name: string
    readonly type: _WireKind
    readonly value: string
    readonly comment: string | undefined
    readonly pullZoneId: number | undefined
    readonly existing: ReadonlyArray<BunnyDnsRecord>
  }
): Effect.Effect<void, DnsError> =>
  Effect.gen(function*() {
    const [keep, ...surplus] = existing
    yield* Effect.forEach(surplus, (r) => _wrap(dns.deleteRecord({ zoneId, recordId: r.Id })), { discard: true })

    if (keep === undefined) {
      yield* _wrap(dns.addRecord({ zoneId, record: _inputOf({ name, type, value, ttl, comment, pullZoneId }) }))
    } else if (!_matches({ existing: keep, value, pullZoneId }) || keep.Ttl !== ttl) {
      yield* _wrap(dns.updateRecord({
        zoneId,
        recordId: keep.Id,
        record: _inputOf({ name, type, value, ttl, comment, pullZoneId })
      }))
    }
  })

const _wireKindFor = (
  { name, options, target }: { readonly name: string; readonly target: string; readonly options: BunnyDnsProviderOptions }
): { readonly type: _WireKind; readonly pullZoneId: number | undefined } => {
  const pullZoneId = name === "" ? options.pullZoneIdFor?.(target) : undefined

  return pullZoneId === undefined ? { type: recordKind(target), pullZoneId: undefined } : { type: "PullZone", pullZoneId }
}

const _ensurePair = (
  { name, options, ownerTarget, target, zone, zoneId }: {
    readonly options: BunnyDnsProviderOptions
    readonly zone: string
    readonly zoneId: number
    readonly name: string
    readonly target: string
    readonly ownerTarget: string | undefined
  }
): Effect.Effect<void, DnsError> =>
  Effect.gen(function*() {
    const { dns } = options
    const comment = _commentFor(ownerTarget)
    const ttl = options.ttl ?? _DEFAULT_TTL
    const all = yield* _wrap(dns.listRecords({ zoneId }))
    const here = all.filter((r) => _nameOf(zone)(r) === name)
    const other = here.filter((r) => r.Type !== "TXT")
    const ownerTxts = here.filter(_isOwnerTxt)
    const foreign = ownerTxts.some((r) => _valueOf(r) !== ownerTarget)

    if (foreign || (other.length > 0 && ownerTxts.length === 0)) {
      return yield* Effect.fail(new ResourceConflict({ kind: "dns-record", ref: `${zone}/${name}` }))
    }

    if (ownerTarget !== undefined) {
      yield* _ensureRaw({ dns, zoneId, name, type: "TXT", value: ownerTarget, comment, ttl, pullZoneId: undefined, existing: ownerTxts })
    }

    const wire = _wireKindFor({ name, options, target })
    yield* Effect.forEach(other.filter((r) => r.Type !== wire.type && _isWritten(r)), (r) => _wrap(dns.deleteRecord({ zoneId, recordId: r.Id })), {
      discard: true
    })
    yield* _ensureRaw({
      dns,
      zoneId,
      name,
      type: wire.type,
      value: target,
      comment,
      ttl,
      pullZoneId: wire.pullZoneId,
      existing: other.filter((r) => r.Type === wire.type)
    })
  })

const _zoneIdOf = (
  { dns, zone }: { readonly dns: BunnyDnsClient; readonly zone: string }
): Effect.Effect<number, DnsError> =>
  _wrap(dns.findZone({ domain: zone })).pipe(
    Effect.flatMap(Option.match({
      onNone: () => Effect.fail(new ResourceNotFound({ kind: "dns-zone", ref: zone })),
      onSome: (found) => Effect.succeed(found.Id)
    }))
  )

export const ensureRecords = (options: BunnyDnsProviderOptions) =>
  (zone: string, records: ReadonlyArray<DesiredRecord>): Effect.Effect<void, DnsError> =>
    Effect.gen(function*() {
      if (records.length === 0) return

      const zoneId = yield* _zoneIdOf({ dns: options.dns, zone })
      const rest = records.filter((r) => !_isOwnershipRecord(r))
      const pairedNames = new Set(rest.map((r) => r.name))
      const orphanTxt = records.filter((r) => _isOwnershipRecord(r) && !pairedNames.has(r.name))

      for (const record of rest) {
        const ownerTarget = _ownerTargetFor({ records, name: record.name })
        yield* _ensurePair({
          options,
          zone,
          zoneId,
          name: _normalize({ name: record.name, zone }),
          target: record.target,
          ownerTarget
        })
      }

      for (const record of orphanTxt) {
        const name = _normalize({ name: record.name, zone })
        const all = yield* _wrap(options.dns.listRecords({ zoneId }))
        yield* _ensureRaw({
          dns: options.dns,
          zoneId,
          name,
          type: "TXT",
          value: record.target,
          comment: _commentFor(record.target),
          ttl: options.ttl ?? _DEFAULT_TTL,
          pullZoneId: undefined,
          existing: all.filter((r) => _nameOf(zone)(r) === name && _isOwnerTxt(r))
        })
      }
    })

export const removeClusterRecords = (options: BunnyDnsProviderOptions) =>
  (zone: string, tag: ClusterTag): Effect.Effect<void, DnsError> =>
    Effect.gen(function*() {
      const { dns } = options
      const zoneId = yield* _zoneIdOf({ dns, zone })
      const all = yield* _wrap(dns.listRecords({ zoneId }))
      const owned = new Set(all.flatMap((r) => _isOwnerTxt(r) && ownerTagOf(_valueOf(r)) === tag ? [_nameOf(zone)(r)] : []))
      const doomed = all.filter((r) => owned.has(_nameOf(zone)(r)) && (_isWritten(r) || (_isOwnerTxt(r) && ownerTagOf(_valueOf(r)) === tag)))

      yield* Effect.forEach(doomed, (r) => _wrap(dns.deleteRecord({ zoneId, recordId: r.Id })), { discard: true })
    })

export const makeBunnyDnsProvider = (options: BunnyDnsProviderOptions) => ({
  ensureRecords: ensureRecords(options),
  removeClusterRecords: removeClusterRecords(options)
})

export const bunnyDnsProviderLive = (options: BunnyDnsProviderOptions) =>
  Layer.succeed(DnsProvider, makeBunnyDnsProvider(options))
