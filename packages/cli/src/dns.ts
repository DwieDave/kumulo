import { Context, Effect, Option } from "effect"
import type * as HttpClient from "effect/http/HttpClient"
import { makeCloudflareDnsClient, zoneNotVisible } from "@kumulo/dns-cloudflare"
import { makeGodaddyDnsClient } from "@kumulo/dns-godaddy"
import { DnsProvider, ownershipTarget, recordKind } from "@kumulo/core"
import type { AuthenticationFailed, ConfigInvalid, DesiredRecord, DnsError, DnsRecordKind } from "@kumulo/core"
import type { ClusterConfig } from "./cluster-config.ts"
import { cloudflareHttpClientFromEnv, dnsRegistry, godaddyHttpClientFromEnv } from "./dns/registry.ts"
import type { DnsLayer } from "./dns/registry.ts"

export type DnsTarget =
  | { readonly kind: "ip"; readonly value: string }
  | { readonly kind: "hostname"; readonly value: string }

export interface DnsTargets {
  readonly api_server: DnsTarget
  readonly ingress?: DnsTarget
  readonly cdn?: DnsTarget
}

const _resolveTarget = (record: DesiredRecord, targets: DnsTargets): DesiredRecord => {
  const resolved = record.target === "api_server" || record.target === "ingress" || record.target === "cdn" ? targets[record.target] : undefined

  return resolved === undefined ? record : { name: record.name, target: resolved.value }
}

// without this ownership tag, removeClusterRecords deletes nothing on cleanup
const _ownershipRecords = (
  records: ReadonlyArray<DesiredRecord>,
  tag: string
): ReadonlyArray<DesiredRecord> => [...new Set(records.map((r) => r.name))].map((name) => ({ name, target: ownershipTarget(tag) }))

export const desiredRecords = (
  { config, targets }: { readonly config: ClusterConfig; readonly targets: DnsTargets }
): ReadonlyArray<DesiredRecord> =>
  config.dns.module === "none" ? [] : [
    ...config.dns.records.map((r) => _resolveTarget(r, targets)),
    ..._ownershipRecords(config.dns.records, config.name)
  ]

// dns.module none: kumulo writes nothing and prints each target it resolved, for the operator to point a name at by hand
export interface ManualDnsTarget {
  readonly name: string
  readonly target: keyof DnsTargets
  readonly type: DnsRecordKind
  readonly value: string
}

// apply provides a sink and prints what it collected after the plan view; without one the targets are dropped
export const ManualDns = Context.Reference<{ readonly add: (targets: ReadonlyArray<ManualDnsTarget>) => void }>(
  "@kumulo/cli/ManualDns",
  { defaultValue: () => ({ add: () => undefined }) }
)

const _targetKeys = ["api_server", "ingress", "cdn"] as const

const _ZONE_PLACEHOLDER = "<zone>"

// the same shapes the README uses for managed modules: api.<cluster> and *.<cluster> under the zone
const _suggestedNames = ({ config, target }: { readonly config: ClusterConfig; readonly target: keyof DnsTargets }): ReadonlyArray<string> => {
  const zone = config.dns.module === "none" ? config.dns.zone ?? _ZONE_PLACEHOLDER : config.dns.zone

  if (target === "api_server") return [`api.${config.name}.${zone}`]

  if (target === "ingress") return [`*.${config.name}.${zone}`]

  return config.cdn !== undefined && "hostnames" in config.cdn ? config.cdn.hostnames : [`cdn.${config.name}.${zone}`]
}

export const manualDnsTargets = (
  { config, targets }: { readonly config: ClusterConfig; readonly targets: DnsTargets }
): ReadonlyArray<ManualDnsTarget> =>
  _targetKeys.flatMap((target) => {
    const resolved = targets[target]

    return resolved === undefined
      ? []
      : _suggestedNames({ config, target }).map((name) => ({ name, target, type: recordKind(resolved.value), value: resolved.value }))
  })

const _table = (rows: ReadonlyArray<ReadonlyArray<string>>): ReadonlyArray<string> => {
  const widths = (rows[0] ?? []).map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length)))

  return rows.map((row) => `  ${row.map((cell, column) => column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)).join("  ")}`)
}

export const renderManualDns = (targets: ReadonlyArray<ManualDnsTarget>): string => {
  const unique = [...new Map(targets.map((t) => [`${t.name} ${t.type} ${t.value}`, t])).values()]

  return unique.length === 0 ? "" : [
    "dns.module is none: kumulo wrote no DNS records. Create these at your DNS host.",
    "The names are suggestions: any name works with the type and value shown.",
    ...(unique.some((t) => t.name.includes(_ZONE_PLACEHOLDER)) ? [`Replace ${_ZONE_PLACEHOLDER} with your domain, or set dns.zone to fill it in.`] : []),
    "",
    ..._table([["TARGET", "NAME", "TYPE", "VALUE"], ...unique.map((t) => [t.target, t.name, t.type, t.value])])
  ].join("\n")
}

export const manualDnsRemovalNote =
  "dns.module is none: kumulo does not manage DNS records. Remove any records pointing at this cluster at your DNS host by hand."

export const reconcileDns = (
  { config, targets }: { readonly config: ClusterConfig; readonly targets: DnsTargets }
): Effect.Effect<void, DnsError, DnsProvider> =>
  Effect.gen(function*() {
    const cfgDns = config.dns

    if (cfgDns.module === "none") {
      (yield* ManualDns).add(manualDnsTargets({ config, targets }))

      return
    }

    const dns = yield* DnsProvider
    yield* dns.ensureRecords(cfgDns.zone, desiredRecords({ config, targets }))
  })

export const removeDns = (config: ClusterConfig): Effect.Effect<void, DnsError, DnsProvider> =>
  Effect.gen(function*() {
    const cfgDns = config.dns

    if (cfgDns.module === "none") return
    const dns = yield* DnsProvider
    yield* dns.removeClusterRecords(cfgDns.zone, config.name)
  })

export const dnsProviderLayerWith = (
  { config, pullZoneIdFor }: { readonly config: ClusterConfig; readonly pullZoneIdFor?: ((target: string) => number | undefined) | undefined }
): DnsLayer =>
  config.dns.module === "none"
    ? dnsRegistry.none.layer({ ttl: 0 })
    : dnsRegistry[config.dns.module].layer({ ttl: config.dns.ttl, pullZoneIdFor })

export const dnsPreflight = (
  config: ClusterConfig
): Effect.Effect<void, DnsError | AuthenticationFailed | ConfigInvalid, HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const cfgDns = config.dns

    if (cfgDns.module === "godaddy") {
      const httpClient = yield* godaddyHttpClientFromEnv()
      yield* makeGodaddyDnsClient(httpClient).probe({ zone: cfgDns.zone })
    }

    if (cfgDns.module === "cloudflare") {
      const httpClient = yield* cloudflareHttpClientFromEnv()
      const zone = yield* makeCloudflareDnsClient(httpClient).findZone({ name: cfgDns.zone })

      if (Option.isNone(zone)) return yield* Effect.fail(zoneNotVisible(cfgDns.zone))
    }
  })
