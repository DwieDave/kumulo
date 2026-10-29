import { Effect, Layer, Option } from "effect"
import { DnsProvider, ProviderApiError, ResourceConflict, ownerTagOf, recordKind } from "@kumulo/core"
import type { ClusterTag, DesiredRecord, DnsError } from "@kumulo/core"
import type { DnsRecord, DnsRecordInput, GodaddyDnsClient } from "../client/godaddy-dns.ts"

const _DEFAULT_TTL = 600

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

const _canonicalData = ({ data, type }: { readonly type: DnsRecordInput["type"]; readonly data: string }): string => {
  const bare = _unquote(data)

  if (type === "CNAME") return bare.toLowerCase().replace(/\.$/, "")

  return type === "AAAA" ? _canonicalIpv6(bare) : bare
}

const _isManaged = (record: DnsRecord): boolean =>
  record.type === "A" || record.type === "AAAA" || record.type === "CNAME"

const _ownerTagOfRecord = (record: DnsRecord): string | undefined =>
  record.type === "TXT" ? ownerTagOf(_unquote(record.data)) : undefined

const _isOwnershipRecord = (record: DesiredRecord): boolean => ownerTagOf(record.target) !== undefined

const _recordsAt = ({ snapshot, name, zone }: {
  readonly snapshot: ReadonlyArray<DnsRecord>
  readonly name: string
  readonly zone: string
}): ReadonlyArray<DnsRecord> => snapshot.filter((r) => _normalize({ name: r.name, zone }) === name)

const _converge = Effect.fn("godaddy.converge")(function*(
  { dns, zone, name, type, data, ttl, existing }: {
    readonly dns: GodaddyDnsClient
    readonly zone: string
    readonly name: string
    readonly type: DnsRecordInput["type"]
    readonly data: string
    readonly ttl: number
    readonly existing: ReadonlyArray<DnsRecord>
  }
) {
  const [keep, ...surplus] = existing
  const record: DnsRecordInput = { name, type, data, ttl }

  if (keep === undefined) {
    yield* dns.createRecord({ zone, record })
  } else if (_canonicalData({ type, data: keep.data }) !== _canonicalData({ type, data }) || keep.ttl !== ttl) {
    yield* dns.replaceRecord({ zone, recordId: keep.recordId, record })
  }

  yield* Effect.forEach(surplus, (r) => dns.deleteRecord({ zone, recordId: r.recordId }), { discard: true })
})

const _ensureName = Effect.fn("godaddy.ensureName")(function*(
  { dns, zone, name, target, ownerTarget, ttl, snapshot }: {
    readonly dns: GodaddyDnsClient
    readonly zone: string
    readonly name: string
    readonly target: string | undefined
    readonly ownerTarget: string | undefined
    readonly ttl: number
    readonly snapshot: ReadonlyArray<DnsRecord>
  }
) {
  const here = _recordsAt({ snapshot, name, zone })
  const ownerTxts = here.filter((r) => _ownerTagOfRecord(r) !== undefined)
  const managed = here.filter(_isManaged)
  const foreignOwner = ownerTxts.some((r) => _unquote(r.data) !== ownerTarget)

  if (foreignOwner || (target !== undefined && managed.length > 0 && ownerTxts.length === 0)) {
    return yield* Effect.fail(new ResourceConflict({ kind: "dns-record", ref: `${zone}/${name}` }))
  }

  if (ownerTarget !== undefined) {
    yield* _converge({ dns, zone, name, type: "TXT", data: ownerTarget, ttl, existing: ownerTxts })
  }

  if (target === undefined) return

  const kind = recordKind(target)

  yield* Effect.forEach(
    managed.filter((r) => r.type !== kind),
    (r) => dns.deleteRecord({ zone, recordId: r.recordId }),
    { discard: true }
  )

  yield* _converge({ dns, zone, name, type: kind, data: target, ttl, existing: managed.filter((r) => r.type === kind) })
})

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

export const makeGodaddyDnsProvider = ({ dns, ttl }: GodaddyDnsProviderOptions) => {
  const effectiveTtl = ttl ?? _DEFAULT_TTL

  return {
    ensureRecords: (zone: string, records: ReadonlyArray<DesiredRecord>): Effect.Effect<void, DnsError> =>
      Effect.gen(function*() {
        yield* _rejectApexCname({ records, zone })

        const snapshot = yield* dns.listRecords({ zone })
        const names = [...new Set(records.map((r) => _normalize({ name: r.name, zone })))]

        for (const name of names) {
          const at = records.filter((r) => _normalize({ name: r.name, zone }) === name)
          const ownerTarget = at.find(_isOwnershipRecord)?.target
          const targets = at.filter((r) => !_isOwnershipRecord(r))

          if (targets.length > 1) {
            return yield* Effect.fail(new ResourceConflict({ kind: "dns-record", ref: `${zone}/${name}` }))
          }

          const target = targets[0]?.target
          yield* _ensureName({ dns, zone, name, target, ownerTarget, ttl: effectiveTtl, snapshot })
        }
      }),
    removeClusterRecords: (zone: string, tag: ClusterTag): Effect.Effect<void, DnsError> =>
      Effect.gen(function*() {
        const snapshot = yield* dns.listRecords({ zone })

        const owned = new Set(
          snapshot.flatMap((r) => _ownerTagOfRecord(r) === tag ? [_normalize({ name: r.name, zone })] : [])
        )

        const contested = new Set(
          snapshot.flatMap((r) => {
            const owner = _ownerTagOfRecord(r)

            return owner !== undefined && owner !== tag ? [_normalize({ name: r.name, zone })] : []
          })
        )

        const doomed = snapshot.filter((r) => {
          const name = _normalize({ name: r.name, zone })

          return owned.has(name) && !contested.has(name) && (_isManaged(r) || _ownerTagOfRecord(r) === tag)
        })

        yield* Effect.forEach(doomed, (r) => dns.deleteRecord({ zone, recordId: r.recordId }), { discard: true })
      })
  }
}

export const godaddyDnsProviderLive = (options: GodaddyDnsProviderOptions) =>
  Layer.succeed(DnsProvider, makeGodaddyDnsProvider(options))
