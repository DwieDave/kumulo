import { Effect, Layer } from "effect"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import { ConfigInvalid, DnsProvider, dnsNoopLive, ownershipTarget } from "@kumulo/core"
import type { AuthenticationFailed, ClusterConfig, DesiredRecord, DnsError } from "@kumulo/core"
import { k3sDnsProviderLayer, k3sHetznerDnsProviderLayer } from "./k3s/env.ts"

/**
 * What the `api_server` record should point at. `ip` yields an A record,
 * `hostname` a CNAME — the record kind is inferred from the resolved target
 * value by the `DnsProvider` (see `recordKind` in the dns packages), so the
 * union only has to pick the value, never a record-type flag (D2/NFR3).
 */
export type DnsTarget =
  | { readonly kind: "ip"; readonly value: string }
  | { readonly kind: "hostname"; readonly value: string }

/**
 * The placeholders a record's `target` may name → what each resolves to (R15).
 * An absent key resolves to nothing and the placeholder reaches the provider
 * literally, exactly as an unrecognised target does — that is what keeps k3s,
 * which supplies no ingress target, behaving as it does today (N1, scope §5).
 */
export interface DnsTargets {
  readonly api_server: DnsTarget
  readonly ingress?: DnsTarget
}

const _resolveTarget = (record: DesiredRecord, targets: DnsTargets): DesiredRecord => {
  const resolved = record.target === "api_server" || record.target === "ingress" ? targets[record.target] : undefined
  return resolved === undefined ? record : { name: record.name, target: resolved.value }
}

/**
 * One `kumulo.cluster=<tag>` TXT record per distinct name — the ownership
 * contract every `DnsProvider` enforces (`ports/dns-provider.ts`). Without it a
 * record kumulo wrote reads as foreign on the next apply (`ResourceConflict`)
 * and `removeClusterRecords` deletes nothing, since it deletes by this same tag.
 */
const _ownershipRecords = (
  records: ReadonlyArray<DesiredRecord>,
  tag: string
): ReadonlyArray<DesiredRecord> => [...new Set(records.map((r) => r.name))].map((name) => ({ name, target: ownershipTarget(tag) }))

/** The desired records for a config, with every known placeholder substituted (exported for plan rendering/testing). */
export const desiredRecords = (
  { config, targets }: { readonly config: ClusterConfig; readonly targets: DnsTargets }
): ReadonlyArray<DesiredRecord> =>
  config.dns.module === "none" ? [] : [
    ...config.dns.records.map((r) => _resolveTarget(r, targets)),
    ..._ownershipRecords(config.dns.records, config.name)
  ]

/**
 * DNS phase: always runs against the resolved `DnsProvider` —
 * `dnsProviderLayerFor` is what makes `dns.module: none` a no-op and an
 * unhandled module a loud `ConfigInvalid` (R6), not this call site.
 */
export const reconcileDns = (
  { config, targets }: { readonly config: ClusterConfig; readonly targets: DnsTargets }
): Effect.Effect<void, DnsError, DnsProvider> =>
  Effect.gen(function*() {
    const cfgDns = config.dns
    if (cfgDns.module === "none") return
    const dns = yield* DnsProvider
    yield* dns.ensureRecords(cfgDns.zone, desiredRecords({ config, targets }))
  })

/** Delete phase: drop every record this cluster owns in its zone. */
export const removeDns = (config: ClusterConfig): Effect.Effect<void, DnsError, DnsProvider> =>
  Effect.gen(function*() {
    const cfgDns = config.dns
    if (cfgDns.module === "none") return
    const dns = yield* DnsProvider
    yield* dns.removeClusterRecords(cfgDns.zone, config.name)
  })

/**
 * `dns.module` → `DnsProvider` Layer — one dispatch function, reused at
 * every construction site (R6). `"none"` is a no-op, `"ovh"`/`"hetzner"`
 * hit their real providers, and any other value (today only `"designate"`)
 * fails loudly with `ConfigInvalid` instead of silently degrading to a no-op.
 */
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
