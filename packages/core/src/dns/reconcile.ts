import { Effect, Layer } from "effect"
import { ResourceConflict } from "../errors/tagged.ts"
import type { ClusterTag, DesiredRecord } from "../domain/types.ts"
import type { DnsError } from "../ports/dns-provider.ts"
import { DnsProvider } from "../ports/dns-provider.ts"
import { ownerTagOf, recordKind } from "./ownership.ts"

const _DEFAULT_TTL = 600

export interface ZoneRecord {
  readonly id?: string | undefined
  readonly name: string
  readonly type: string
  readonly value: string
  readonly ttl: number
}

// The provider-specific half of DNS reconciliation. `canonical` must make
// equivalent values compare equal (unquote TXT, lowercase CNAME and drop the
// trailing dot, compress IPv6); `normalize` maps any name spelling to one key.
export interface DnsAdapter {
  readonly ttl?: number | undefined
  readonly list: (zone: string) => Effect.Effect<ReadonlyArray<ZoneRecord>, DnsError>
  readonly create: (input: { readonly zone: string; readonly record: ZoneRecord }) => Effect.Effect<void, DnsError>
  readonly update: (input: {
    readonly zone: string
    readonly existing: ZoneRecord
    readonly record: ZoneRecord
  }) => Effect.Effect<void, DnsError>
  readonly delete: (input: { readonly zone: string; readonly record: ZoneRecord }) => Effect.Effect<void, DnsError>
  readonly normalize: (input: { readonly name: string; readonly zone: string }) => string
  readonly canonical: (input: { readonly type: string; readonly value: string }) => string
}

const _isManaged = (record: ZoneRecord): boolean =>
  record.type === "A" || record.type === "AAAA" || record.type === "CNAME"

const _isOwnershipRecord = (record: DesiredRecord): boolean => ownerTagOf(record.target) !== undefined

const _conflict = ({ zone, name }: { readonly zone: string; readonly name: string }) =>
  new ResourceConflict({ kind: "dns-record", ref: `${zone}/${name}` })

export const reconcileDns = (adapter: DnsAdapter) => {
  const ttl = adapter.ttl ?? _DEFAULT_TTL
  const canon = (record: ZoneRecord): string => adapter.canonical({ type: record.type, value: record.value })

  const nameOf = (zone: string) => (record: { readonly name: string }): string =>
    adapter.normalize({ name: record.name, zone })

  // only a TXT whose canonical value carries the ownership prefix counts
  const ownerTagOfRecord = (record: ZoneRecord): string | undefined =>
    record.type === "TXT" ? ownerTagOf(canon(record)) : undefined

  const converge = Effect.fn("dns.converge")(function*(
    { zone, name, type, value, existing }: {
      readonly zone: string
      readonly name: string
      readonly type: string
      readonly value: string
      readonly existing: ReadonlyArray<ZoneRecord>
    }
  ) {
    const [keep, ...surplus] = existing
    const record: ZoneRecord = { name, type, value, ttl }

    if (keep === undefined) {
      yield* adapter.create({ zone, record })
    } else if (canon(keep) !== adapter.canonical({ type, value }) || keep.ttl !== ttl) {
      yield* adapter.update({ zone, existing: keep, record })
    }

    yield* Effect.forEach(surplus, (r) => adapter.delete({ zone, record: r }), { discard: true })
  })

  const ensureName = Effect.fn("dns.ensureName")(function*(
    { zone, name, target, ownerTarget, snapshot }: {
      readonly zone: string
      readonly name: string
      readonly target: string | undefined
      readonly ownerTarget: string | undefined
      readonly snapshot: ReadonlyArray<ZoneRecord>
    }
  ) {
    const here = snapshot.filter((r) => nameOf(zone)(r) === name)
    const ownerTxts = here.filter((r) => ownerTagOfRecord(r) !== undefined)
    const managed = here.filter(_isManaged)
    const ownerCanonical = ownerTarget === undefined ? undefined : adapter.canonical({ type: "TXT", value: ownerTarget })
    const foreignOwner = ownerTxts.some((r) => canon(r) !== ownerCanonical)

    if (foreignOwner || (target !== undefined && managed.length > 0 && ownerTxts.length === 0)) {
      return yield* Effect.fail(_conflict({ zone, name }))
    }

    if (ownerTarget !== undefined) {
      yield* converge({ zone, name, type: "TXT", value: ownerTarget, existing: ownerTxts })
    }

    if (target === undefined) return

    const kind = recordKind(target)

    yield* Effect.forEach(
      managed.filter((r) => r.type !== kind),
      (r) => adapter.delete({ zone, record: r }),
      { discard: true }
    )

    yield* converge({ zone, name, type: kind, value: target, existing: managed.filter((r) => r.type === kind) })
  })

  return {
    ensureRecords: (zone: string, records: ReadonlyArray<DesiredRecord>): Effect.Effect<void, DnsError> =>
      Effect.gen(function*() {
        const snapshot = yield* adapter.list(zone)
        const names = [...new Set(records.map(nameOf(zone)))]

        for (const name of names) {
          const at = records.filter((r) => nameOf(zone)(r) === name)
          const ownerTarget = at.find(_isOwnershipRecord)?.target
          const targets = at.filter((r) => !_isOwnershipRecord(r))

          if (targets.length > 1) return yield* Effect.fail(_conflict({ zone, name }))

          yield* ensureName({ zone, name, target: targets[0]?.target, ownerTarget, snapshot })
        }
      }),
    removeClusterRecords: (zone: string, tag: ClusterTag): Effect.Effect<void, DnsError> =>
      Effect.gen(function*() {
        const snapshot = yield* adapter.list(zone)
        const owned = new Set<string>()
        const contested = new Set<string>()

        for (const r of snapshot) {
          const owner = ownerTagOfRecord(r)

          if (owner === tag) owned.add(nameOf(zone)(r))
          else if (owner !== undefined) contested.add(nameOf(zone)(r))
        }

        const doomed = snapshot.filter((r) => {
          const name = nameOf(zone)(r)

          return owned.has(name) && !contested.has(name) && (_isManaged(r) || ownerTagOfRecord(r) === tag)
        })

        yield* Effect.forEach(doomed, (r) => adapter.delete({ zone, record: r }), { discard: true })
      })
  }
}

export const reconcileDnsLive = (adapter: DnsAdapter) => Layer.succeed(DnsProvider, reconcileDns(adapter))
