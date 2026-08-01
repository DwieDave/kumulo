import { Effect, Layer } from "effect"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import { ConfigInvalid, DnsProvider, dnsNoopLive, ownershipTarget } from "@kumulo/core"
import type { AuthenticationFailed, DesiredRecord, DnsError } from "@kumulo/core"
import type { ClusterConfig } from "./cluster-config.ts"
import { k3sDnsProviderLayer, k3sHetznerDnsProviderLayer } from "./k3s/env.ts"

export type DnsTarget =
  | { readonly kind: "ip"; readonly value: string }
  | { readonly kind: "hostname"; readonly value: string }

export interface DnsTargets {
  readonly api_server: DnsTarget
  readonly ingress?: DnsTarget
}

const _resolveTarget = (record: DesiredRecord, targets: DnsTargets): DesiredRecord => {
  const resolved = record.target === "api_server" || record.target === "ingress" ? targets[record.target] : undefined
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

export const dnsProviderLayerFor = (
  config: ClusterConfig
): Layer.Layer<DnsProvider, AuthenticationFailed | ConfigInvalid, HttpClient.HttpClient> => {
  const dnsModule = config.dns.module
  if (dnsModule === "ovh") return k3sDnsProviderLayer()
  if (dnsModule === "hetzner") return k3sHetznerDnsProviderLayer()
  if (dnsModule === "none") return dnsNoopLive
  return Layer.effect(
    DnsProvider,
    Effect.fail(
      new ConfigInvalid({
        issues: [{ path: ["dns", "module"], message: `dns.module "${dnsModule}" has no DnsProvider implementation` }]
      })
    )
  )
}
