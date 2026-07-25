import { Context, Effect, Layer, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { AuthenticationFailed } from "@kumulo/core"
import type { ClusterConfig } from "@kumulo/core"
import { buildFr57Rules } from "@kumulo/openstack"
import { makeDnsClient, ovhDnsProviderLive } from "@kumulo/dns-ovh"
import { HetznerHttpLive, hetznerDnsProviderLive, makeHetznerDnsClient } from "@kumulo/dns-hetzner"
import { CinderAuth, VolumeProviderLive } from "@kumulo/volumes-cinder"
import type { VolumeProviderOptions } from "@kumulo/volumes-cinder"
import { VolumeProviderLive as HcloudVolumeProviderLive } from "@kumulo/hetzner"
import { OpenStackEnv } from "../doctor-openstack/env.ts"
import { requiredRedactedEnv } from "../env.ts"
import { hcloudHttpClientLayer, providerFor } from "../provider/registry.ts"
import { ovhHttpClientFromEnv } from "../mks/env.ts"

/**
 * `addons`/`k3s` are optional in `ClusterConfig` (managed distros omit them)
 * but schema-guaranteed present when `distro: k3s` — the only path that reads
 * them. The fallbacks here exist purely to keep the accessor total for the
 * type system; they are unreachable after a successful decode.
 */
export const k3sBlocks = (
  config: ClusterConfig
): { addons: NonNullable<ClusterConfig["addons"]>; k3s: NonNullable<ClusterConfig["k3s"]> } => ({
  addons: config.addons ?? {
    cloud_controller_manager: false,
    cinder_csi: { enabled: false, default_volume_type: "classic" },
    hcloud_csi: { enabled: false },
    system_upgrade_controller: false,
    cni: "flannel"
  },
  k3s: config.k3s ?? { extra_server_args: [], extra_agent_args: [] }
})

/** Security-group rules for this cluster's network CIDR/allowed CIDRs/CNI choice. */
export const secGroupRules = (config: ClusterConfig) =>
  buildFr57Rules({
    allowedSshCidrs: config.ssh.allowed_cidrs,
    allowedApiCidrs: config.api_server.allowed_cidrs,
    networkCidr: config.network.cidr,
    cni: k3sBlocks(config).addons.cni
  })

/** Same Cinder-backed `VolumeProvider` construction as `commands/volumes.ts`'s `reconcileVolumesOnDelete`. */
export const k3sVolumeProviderLayer = (
  options: VolumeProviderOptions
): Layer.Layer<import("@kumulo/core").VolumeProvider, never, CinderAuth | HttpClient.HttpClient> => VolumeProviderLive(options)

/**
 * `dns-ovh`'s `DnsProvider`, built from the same OVH OAuth2
 * client-credentials env vars as `MksEnv` (one OVH account, shared by
 * whichever distro's config asks for `dns.module: ovh`).
 */
export const k3sDnsProviderLayer = (): Layer.Layer<import("@kumulo/core").DnsProvider, AuthenticationFailed, HttpClient.HttpClient> =>
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
export const k3sHetznerDnsProviderLayer = (): Layer.Layer<import("@kumulo/core").DnsProvider, AuthenticationFailed, HttpClient.HttpClient> =>
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
): Layer.Layer<import("@kumulo/core").VolumeProvider, AuthenticationFailed, HttpClient.HttpClient> =>
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
  config: ClusterConfig
): Layer.Layer<CloudCredentialEnv, AuthenticationFailed, OpenStackEnv> =>
  Layer.effect(CloudCredentialEnv, providerFor(config).cloudCredential(config))
