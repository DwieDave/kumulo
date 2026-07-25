import { Effect, Layer } from "effect"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import { ConfigInvalid, DnsProvider, dnsNoopLive } from "@kumulo/core"
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

const _resolveTarget = (record: DesiredRecord, apiTarget: DnsTarget): DesiredRecord =>
  record.target === "api_server" ? { name: record.name, target: apiTarget.value } : record

/** The desired records for a config, with `api_server` substituted (exported for plan rendering/testing). */
export const desiredRecords = (
  { apiTarget, config }: { readonly config: ClusterConfig; readonly apiTarget: DnsTarget }
): ReadonlyArray<DesiredRecord> => config.dns.records.map((r) => _resolveTarget(r, apiTarget))

/**
 * DNS phase: always runs against the resolved `DnsProvider` —
 * `dnsProviderLayerFor` is what makes `dns.module: none` a no-op and an
 * unhandled module a loud `ConfigInvalid` (R6), not this call site.
 */
export const reconcileDns = (
  { apiTarget, config }: { readonly config: ClusterConfig; readonly apiTarget: DnsTarget }
): Effect.Effect<void, DnsError, DnsProvider> =>
  Effect.gen(function*() {
    const dns = yield* DnsProvider
    yield* dns.ensureRecords(config.dns.zone, desiredRecords({ config, apiTarget }))
  })

/** Delete phase: drop every record this cluster owns in its zone. */
export const removeDns = (config: ClusterConfig): Effect.Effect<void, DnsError, DnsProvider> =>
  Effect.gen(function*() {
    const dns = yield* DnsProvider
    yield* dns.removeClusterRecords(config.dns.zone, config.name)
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
