import { Effect, Option } from "effect"
import type * as HttpClient from "effect/http/HttpClient"
import { makeCloudflareDnsClient, zoneNotVisible } from "@kumulo/dns-cloudflare"
import { makeGodaddyDnsClient } from "@kumulo/dns-godaddy"
import { DnsProvider, ownershipTarget } from "@kumulo/core"
import type { AuthenticationFailed, ConfigInvalid, DesiredRecord, DnsError } from "@kumulo/core"
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

export const reconcileDns = (
  { config, targets }: { readonly config: ClusterConfig; readonly targets: DnsTargets }
): Effect.Effect<void, DnsError, DnsProvider> =>
  Effect.gen(function*() {
    const cfgDns = config.dns

    if (cfgDns.module === "none") return
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
