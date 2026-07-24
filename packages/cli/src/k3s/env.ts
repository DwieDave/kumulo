import { Config, Context, Effect, Layer, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { AuthenticationFailed } from "@kumulo/core"
import type { ClusterConfig } from "@kumulo/core"
import { buildFr57Rules, CloudProviderLive, KeystoneAuth } from "@kumulo/openstack"
import type { CloudProviderOptions } from "@kumulo/openstack"
import { makeDnsClient, ovhDnsProviderLive } from "@kumulo/dns-ovh"
import { HetznerHttpLive, hetznerDnsProviderLive, makeHetznerDnsClient } from "@kumulo/dns-hetzner"
import { CinderAuth, VolumeProviderLive } from "@kumulo/volumes-cinder"
import type { VolumeProviderOptions } from "@kumulo/volumes-cinder"
import {
  CloudProviderLive as HcloudCloudProviderLive,
  hcloudHttpClientLayer,
  VolumeProviderLive as HcloudVolumeProviderLive
} from "@kumulo/hetzner"
import { OvhAuthLive, ovhHttpClientLayer } from "@kumulo/provider-ovh"
import { OpenStackEnv } from "../doctor-openstack/env.ts"
import { requiredEnv, requiredRedactedEnv } from "../mks/env.ts"

/** Security-group rules for this cluster's network CIDR/allowed CIDRs/CNI choice. */
export const secGroupRules = (config: ClusterConfig) =>
  buildFr57Rules({
    allowedSshCidrs: config.ssh.allowed_cidrs,
    allowedApiCidrs: config.api_server.allowed_cidrs,
    networkCidr: config.network.cidr,
    cni: config.addons.cni
  })

const _cloudProviderOptions = (config: ClusterConfig, region: string): CloudProviderOptions => ({
  tag: config.name,
  region,
  octaviaEnabled: config.api_server.high_availability,
  imageAliases: {}
})

/**
 * The k3s composition root's OpenStack `CloudProvider`, reusing the
 * already-resolved `OpenStackEnv` (shared with the doctor checks and
 * `CinderAuth`) instead of re-deriving Keystone auth. Fails at first use
 * (never at Layer-build time) when OpenStack credentials are missing, same
 * contract as `OpenStackEnv`/`CinderAuthLive`.
 */
export const k3sCloudProviderLayer = (
  config: ClusterConfig
): Layer.Layer<import("@kumulo/core").CloudProvider, AuthenticationFailed, OpenStackEnv | HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function*() {
      const env = yield* OpenStackEnv
      if (env.keystone === undefined || env.region === undefined) {
        return yield* Effect.fail(new AuthenticationFailed({ hint: env.unavailableReason ?? "OpenStack auth unavailable" }))
      }
      return CloudProviderLive(_cloudProviderOptions(config, env.region)).pipe(
        Layer.provide(Layer.succeed(KeystoneAuth, env.keystone))
      )
    })
  )

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
      const clientId = yield* requiredEnv("OVH_CLIENT_ID")
      const clientSecret = yield* requiredRedactedEnv("OVH_CLIENT_SECRET")
      const authLayer = OvhAuthLive({ clientId, clientSecret })
      const httpClientLayer = ovhHttpClientLayer().pipe(Layer.provide(authLayer))
      const httpClient = yield* Effect.provide(HttpClient.HttpClient, httpClientLayer)
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

/** `HCLOUD_TOKEN`-backed `HttpClient`, shared by the two hcloud compute Layers below. */
const _hcloudHttpClientLayer = (): Layer.Layer<HttpClient.HttpClient, AuthenticationFailed, HttpClient.HttpClient> =>
  Layer.unwrap(Effect.map(requiredRedactedEnv("HCLOUD_TOKEN"), (token) => hcloudHttpClientLayer(token)))

/**
 * Hetzner-backed `CloudProvider` for `provider: "hetzner"` configs —
 * `auth.region` is reinterpreted as the hcloud location (D8, no dedicated
 * field). Mirrors `k3sCloudProviderLayer`'s shape.
 */
export const k3sHetznerCloudProviderLayer = (
  config: ClusterConfig
): Layer.Layer<import("@kumulo/core").CloudProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  HcloudCloudProviderLive({ tag: config.name, location: config.auth.region }).pipe(Layer.provide(_hcloudHttpClientLayer()))

/** Hetzner-backed `VolumeProvider` for `volumes.module: "hcloud"` configs. Mirrors `k3sVolumeProviderLayer`'s shape. */
export const k3sHetznerVolumeProviderLayer = (
  config: ClusterConfig
): Layer.Layer<import("@kumulo/core").VolumeProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  HcloudVolumeProviderLive({ tag: config.name, location: config.auth.region }).pipe(Layer.provide(_hcloudHttpClientLayer()))

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

// `cloud.conf` is rendered to a plain-string INI (`renderCloudConfIni`), so
// the secret is unwrapped here at that render boundary rather than threaded
// as `Redacted` through `@kumulo/addons`. `withDefault` only leaves the
// never-reachable validation-error branch of `ConfigError` (plain/redacted
// string schemas accept any string) — `orDie` documents that. Same
// forgiving, never-failing read `_installAddons` always did (R2: zero
// behavior change for `provider: "ovh"/"generic"` configs).
const _openStackCredentialFromEnv = (region: string): Effect.Effect<CloudCredentialShape> =>
  Effect.gen(function*() {
    const authUrl = yield* Config.string("OS_AUTH_URL").pipe(Config.withDefault(""))
    const applicationCredentialId = yield* Config.string("OS_APPLICATION_CREDENTIAL_ID").pipe(Config.withDefault(""))
    const applicationCredentialSecret = yield* Config.redacted("OS_APPLICATION_CREDENTIAL_SECRET").pipe(
      Config.withDefault(Redacted.make(""))
    )
    return {
      provider: "openstack" as const,
      authUrl,
      region,
      applicationCredentialId,
      applicationCredentialSecret: Redacted.value(applicationCredentialSecret)
    }
  }).pipe(Effect.orDie)

/**
 * `config.provider`-branched `CloudCredentialEnv` (R11, provider-branched
 * the same way `k3sCloudProviderLayer` is): `HCLOUD_TOKEN` — loud on
 * missing, N5 — for `"hetzner"`, the existing forgiving OS_* read otherwise.
 */
export const k3sCloudCredentialLayer = (
  config: ClusterConfig
): Layer.Layer<CloudCredentialEnv, AuthenticationFailed, OpenStackEnv> =>
  Layer.effect(
    CloudCredentialEnv,
    Effect.gen(function*() {
      if (config.provider === "hetzner") {
        const token = yield* requiredRedactedEnv("HCLOUD_TOKEN")
        return { provider: "hetzner" as const, token }
      }
      const env = yield* OpenStackEnv
      return yield* _openStackCredentialFromEnv(env.region ?? "")
    })
  )
