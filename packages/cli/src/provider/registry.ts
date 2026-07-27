import { Config, Effect, Layer, Redacted } from "effect"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import { AuthenticationFailed } from "@kumulo/core"
import type { ClusterConfig, CloudProvider, K3sClusterConfig, SecGroupSpec } from "@kumulo/core"
import { buildFr57Rules, CloudProviderLive, KeystoneAuth, OpenStackHttpLive } from "@kumulo/openstack"
import type { CloudProviderOptions } from "@kumulo/openstack"
import { buildHetznerSecGroupRules, CloudProviderLive as HcloudCloudProviderLive, hcloudHttpClientLive } from "@kumulo/hetzner"
import { OpenStackEnv } from "../doctor-openstack/env.ts"
import { requiredRedactedEnv } from "../env.ts"
import type { CloudCredentialShape } from "../k3s/env.ts"

export type ProviderKind = ClusterConfig["provider"]

export interface ProviderEntry {
  readonly kind: ProviderKind
  readonly cloudProviderLayer: (
    config: K3sClusterConfig
  ) => Layer.Layer<CloudProvider, AuthenticationFailed, OpenStackEnv | HttpClient.HttpClient>
  readonly cloudCredential: (config: K3sClusterConfig) => Effect.Effect<CloudCredentialShape, AuthenticationFailed, OpenStackEnv>
  /** Ingress rules for this cluster in core's neutral dialect — every adapter's `ensureSecurityGroups` translates them itself. */
  readonly secGroupRules: (config: K3sClusterConfig) => SecGroupSpec["rules"]
  /** Env vars this provider's own wiring reads (empty when the distro's credentials cover it). */
  readonly requiredEnvVars: ReadonlyArray<string>
  /** True when the distro's credentials cover this provider — the env summary then titles the section from the distro entry. */
  readonly credentialsFromDistro: boolean
}

const _cloudProviderOptions = (config: K3sClusterConfig, region: string): CloudProviderOptions => ({
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
  config: K3sClusterConfig
): Layer.Layer<CloudProvider, AuthenticationFailed, OpenStackEnv | HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function*() {
      const env = yield* OpenStackEnv
      if (env.keystone === undefined || env.region === undefined) {
        return yield* Effect.fail(new AuthenticationFailed({ hint: env.unavailableReason ?? "OpenStack auth unavailable" }))
      }
      // The token/retry/semaphore wrapper (`OpenStackHttpLive`) sits between
      // the generated Nova/Neutron/Glance/Octavia clients and the ambient
      // `HttpClient` — without it every call ships without `X-Auth-Token`.
      const keystone = Layer.succeed(KeystoneAuth, env.keystone)
      return CloudProviderLive(_cloudProviderOptions(config, env.region)).pipe(
        Layer.provide(OpenStackHttpLive().pipe(Layer.provide(keystone))),
        Layer.provide(keystone)
      )
    })
  )

/** `HCLOUD_TOKEN`-backed `HttpClient`, shared by the hcloud compute Layers. */
export const hcloudHttpClientLayer = (): Layer.Layer<HttpClient.HttpClient, AuthenticationFailed, HttpClient.HttpClient> =>
  Layer.unwrap(Effect.map(requiredRedactedEnv("HCLOUD_TOKEN"), (token) => hcloudHttpClientLive(token)))

/**
 * Hetzner-backed `CloudProvider` for `provider: "hetzner"` configs —
 * `auth.region` is reinterpreted as the hcloud location (D8, no dedicated
 * field). Mirrors `k3sCloudProviderLayer`'s shape.
 */
export const k3sHetznerCloudProviderLayer = (
  config: K3sClusterConfig
): Layer.Layer<CloudProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  HcloudCloudProviderLive({ tag: config.name, location: config.auth.region }).pipe(Layer.provide(hcloudHttpClientLayer()))

// `cloud.conf` is rendered to a plain-string INI (`renderCloudConfIni`), so
// the secret is unwrapped here at that render boundary rather than threaded
// as `Redacted` through `@kumulo/addons`. `withDefault` only leaves the
// never-reachable validation-error branch of `ConfigError` (plain/redacted
// string schemas accept any string) — `orDie` documents that.
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

const _openStackCredential = (): Effect.Effect<CloudCredentialShape, AuthenticationFailed, OpenStackEnv> =>
  Effect.flatMap(OpenStackEnv, (env) => _openStackCredentialFromEnv(env.region ?? ""))

const _hetznerCredential = (): Effect.Effect<CloudCredentialShape, AuthenticationFailed> =>
  Effect.map(requiredRedactedEnv("HCLOUD_TOKEN"), (token) => ({ provider: "hetzner" as const, token }))

/** Shared inputs of both providers' rule builders — SSH/API CIDRs, the cluster network, the CNI's wireguard port. */
const _ruleOptions = (config: K3sClusterConfig) => ({
  allowedSshCidrs: config.ssh.allowed_cidrs,
  allowedApiCidrs: config.api_server.allowed_cidrs,
  networkCidr: config.network.cidr,
  cni: config.addons.cni
})

/** `provider: "ovh"` and `"generic"` share one OpenStack wiring today. */
const _openStackEntry = (kind: ProviderKind): ProviderEntry => ({
  kind,
  cloudProviderLayer: k3sCloudProviderLayer,
  cloudCredential: _openStackCredential,
  secGroupRules: (config) => buildFr57Rules(_ruleOptions(config)),
  // Credentials come from the distro here (OVH API for mks, OS_* for k3s),
  // so the env summary titles this section from the distro entry instead.
  requiredEnvVars: [],
  credentialsFromDistro: true
})

/** Adding a `provider` literal breaks compilation here until its entry exists. */
export const providerRegistry: Record<ProviderKind, ProviderEntry> = {
  ovh: _openStackEntry("ovh"),
  generic: _openStackEntry("generic"),
  hetzner: {
    kind: "hetzner",
    cloudProviderLayer: k3sHetznerCloudProviderLayer,
    cloudCredential: _hetznerCredential,
    secGroupRules: (config) => buildHetznerSecGroupRules(_ruleOptions(config)),
    requiredEnvVars: ["HCLOUD_TOKEN"],
    credentialsFromDistro: false
  }
}

export const providerFor = (config: ClusterConfig): ProviderEntry => providerRegistry[config.provider]
