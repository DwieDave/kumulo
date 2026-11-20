import { Effect, Layer, Option } from "effect"
import { DnsProvider, reconcileDns } from "@kumulo/core"
import type { DnsAdapter, DnsError, ZoneRecord } from "@kumulo/core"
import type { HetznerDns, HetznerDnsError, HetznerRRset } from "../client/hetzner-dns.ts"
import { toDnsError } from "../errors.ts"

const _APEX = "@"
const _DEFAULT_TTL = 300

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

const _toZoneRecords = (rrset: HetznerRRset): ReadonlyArray<ZoneRecord> =>
  rrset.records.map((r) => ({ name: rrset.name, type: rrset.type, value: r.value, ttl: rrset.ttl }))

const _wrap = <A>(
  { name, self, zone }: {
    readonly zone: string
    readonly name: string
    readonly self: Effect.Effect<A, HetznerDnsError>
  }
): Effect.Effect<A, DnsError> => Effect.mapError(self, (cause) => toDnsError({ cause, zone, name }))

export interface HetznerDnsProviderOptions {
  readonly dns: HetznerDns
  readonly ttl?: number | undefined
}

// A Hetzner RRset holds every value of one (name, type), so each write reads the current set and puts the merged one:
// replacing the whole set would wipe foreign values at the same name (an SPF TXT beside the ownership TXT).
export const makeHetznerDnsAdapter = ({ dns, ttl }: HetznerDnsProviderOptions): DnsAdapter => {
  const currentValues = ({ name, type, zone }: { readonly zone: string; readonly name: string; readonly type: string }) =>
    _wrap({ zone, name, self: dns.listRRsets(zone) }).pipe(
      Effect.map((all) =>
        all.filter((r) => r.name === name && r.type === type).flatMap((r) => r.records.map((v) => v.value))
      )
    )

  const writeValues = (
    { name, ttl: setTtl, type, values, zone }: {
      readonly zone: string
      readonly name: string
      readonly type: string
      readonly values: ReadonlyArray<string>
      readonly ttl: number
    }
  ): Effect.Effect<void, DnsError> =>
    _wrap({
      zone,
      name,
      self: values.length === 0
        ? dns.deleteRRset(zone, name, type)
        : Effect.asVoid(dns.putRRset(zone, name, type, { ttl: setTtl, records: values.map((value) => ({ value })) }))
    })

  const same = (type: string) => (a: string) => (b: string): boolean => _canonical({ type, value: a }) === _canonical({ type, value: b })

  return {
    ttl: ttl ?? _DEFAULT_TTL,
    list: (zone) => _wrap({ zone, name: "*", self: dns.listRRsets(zone) }).pipe(Effect.map((all) => all.flatMap(_toZoneRecords))),
    create: ({ record, zone }) =>
      Effect.flatMap(
        currentValues({ zone, name: record.name, type: record.type }),
        (values) =>
          writeValues({ zone, name: record.name, type: record.type, ttl: record.ttl, values: [...values, record.value] })
      ),
    update: ({ existing, record, zone }) =>
      Effect.flatMap(currentValues({ zone, name: record.name, type: record.type }), (values) => {
        const matches = same(record.type)(existing.value)

        return writeValues({
          zone,
          name: record.name,
          type: record.type,
          ttl: record.ttl,
          values: values.some(matches) ? values.map((v) => matches(v) ? record.value : v) : [...values, record.value]
        })
      }),
    delete: ({ record, zone }) =>
      Effect.flatMap(currentValues({ zone, name: record.name, type: record.type }), (values) =>
        writeValues({
          zone,
          name: record.name,
          type: record.type,
          ttl: record.ttl,
          values: values.filter((v) => !same(record.type)(record.value)(v))
        })),
    normalize: _normalize,
    canonical: _canonical
  }
}

export const makeHetznerDnsProvider = (options: HetznerDnsProviderOptions) => reconcileDns(makeHetznerDnsAdapter(options))

export const hetznerDnsProviderLive = (options: HetznerDnsProviderOptions) =>
  Layer.succeed(DnsProvider, makeHetznerDnsProvider(options))
