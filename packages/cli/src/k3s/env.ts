import type { Redacted } from "effect";
import { Context, Effect, Layer } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type { AuthenticationFailed } from "@kumulo/core"
import type { ClusterConfig, DnsProvider, K3sClusterConfig, VolumeProvider } from "@kumulo/core"
import { makeDnsClient, ovhDnsProviderLive } from "@kumulo/dns-ovh"
import { HetznerHttpLive, hetznerDnsProviderLive, makeHetznerDnsClient } from "@kumulo/dns-hetzner"
import { VolumeProviderLive } from "@kumulo/volumes-cinder"
import type { VolumeProviderOptions , CinderAuth} from "@kumulo/volumes-cinder"
import { VolumeProviderLive as HcloudVolumeProviderLive } from "@kumulo/hetzner"
import type { OpenStackEnv } from "../doctor-openstack/env.ts"
import { requiredRedactedEnv } from "../env.ts"
import { hcloudHttpClientLayer, providerFor } from "../provider/registry.ts"
import { ovhHttpClientFromEnv } from "../mks/env.ts"

/**
 * Security-group rules for this cluster — built by the active provider, since
 * Neutron rules and Hetzner firewall rules are different shapes and each
 * adapter only decodes its own.
 */
export const secGroupRules = (config: K3sClusterConfig) => providerFor(config).secGroupRules(config)

/** Same Cinder-backed `VolumeProvider` construction as `commands/volumes.ts`'s `reconcileVolumesOnDelete`. */
export const k3sVolumeProviderLayer = (
  options: VolumeProviderOptions
): Layer.Layer<VolumeProvider, never, CinderAuth | HttpClient.HttpClient> => VolumeProviderLive(options)

/**
 * `dns-ovh`'s `DnsProvider`, built from the same OVH OAuth2
 * client-credentials env vars as `MksEnv` (one OVH account, shared by
 * whichever distro's config asks for `dns.module: ovh`).
 */
export const k3sDnsProviderLayer = (): Layer.Layer<DnsProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function*() {
      const httpClient = yield* Effect.provide(HttpClient.HttpClient, ovhHttpClientFromEnv())
      return ovhDnsProviderLive(makeDnsClient(httpClient))
    })
  )

/**
 * `dns-hetzner`'s `DnsProvider`, `HETZNER_DNS_TOKEN`-backed (hetzner-dns
 * plan R7) — a separate env var from `HCLOUD_TOKEN` below so a DNS-only or
 * compute-only setup doesn't need to over-scope a single token (both plans'
 * shared note: one hcloud project token can serve both, if the operator
 * wants).
 */
export const k3sHetznerDnsProviderLayer = (): Layer.Layer<DnsProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function*() {
      const token = yield* requiredRedactedEnv("HETZNER_DNS_TOKEN")
      const httpClient = yield* Effect.provide(HttpClient.HttpClient, HetznerHttpLive({ token }))
      return hetznerDnsProviderLive(makeHetznerDnsClient(httpClient))
    })
  )

/** Hetzner-backed `VolumeProvider` for `volumes.module: "hcloud"` configs. Mirrors `k3sVolumeProviderLayer`'s shape. */
export const k3sHetznerVolumeProviderLayer = (
  config: ClusterConfig
): Layer.Layer<VolumeProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  HcloudVolumeProviderLive({ tag: config.name, location: config.auth.region }).pipe(Layer.provide(hcloudHttpClientLayer()))

// ---- CloudCredentialEnv (R11/D5): addon-facing cloud credentials ----------

export type CloudCredentialShape =
  | {
    readonly provider: "openstack"
    readonly authUrl: string
    readonly region: string
    readonly applicationCredentialId: string
    readonly applicationCredentialSecret: string
  }
  | { readonly provider: "hetzner"; readonly token: Redacted.Redacted<string> }

/**
 * Holds whichever cloud's CCM/CSI addon credentials the active
 * `config.provider` needs — `_installAddons` (`k3s/reconcile.ts`) depends on
 * this discriminated union instead of `OpenStackEnv` directly, so the
 * addons phase stays provider-neutral the same way the rest of
 * `applyK3sEffect` already is.
 */
export class CloudCredentialEnv extends Context.Service<CloudCredentialEnv, CloudCredentialShape>()("@kumulo/cli/CloudCredentialEnv") {}

/** `config.provider`-branched `CloudCredentialEnv` (R11) — the branch itself lives in the provider registry. */
export const k3sCloudCredentialLayer = (
  config: K3sClusterConfig
): Layer.Layer<CloudCredentialEnv, AuthenticationFailed, OpenStackEnv> =>
  Layer.effect(CloudCredentialEnv, providerFor(config).cloudCredential(config))
