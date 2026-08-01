import { Config, Effect, Layer, Redacted } from "effect"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import { AuthenticationFailed, CloudProvider } from "@kumulo/core"
import type { SecGroupSpec } from "@kumulo/core"
import type { ClusterConfig, K3sClusterConfig } from "../cluster-config.ts"
import { buildFr57Rules, CloudProviderLive, KeystoneAuth, OpenStackHttpLive } from "@kumulo/openstack"
import type { CloudProviderOptions } from "@kumulo/openstack"
import { buildHetznerSecGroupRules, CloudProviderLive as HcloudCloudProviderLive, hcloudHttpClientLive } from "@kumulo/hetzner"
import { hasOctavia } from "@kumulo/provider-ovh"
import { OpenStackEnv } from "../doctor-openstack/env.ts"
import type { OpenStackEnvShape } from "../doctor-openstack/env.ts"
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

type OpenStackCloudProviderLayer = Layer.Layer<CloudProvider, AuthenticationFailed, OpenStackEnv | HttpClient.HttpClient>

/**
 * Every verb fails with the `AuthenticationFailed` the Layer would once have
 * failed to *build* with. Building it eagerly made missing OS_* credentials
 * fatal to callers that never touch OpenStack — an `ovh-mks` apply with no
 * `network` block reaches no verb at all and must still run (R5).
 */
const _unavailableCloudProvider = (hint: string): Layer.Layer<CloudProvider> => {
  const reject = () => Effect.fail(new AuthenticationFailed({ hint }))
  return Layer.succeed(CloudProvider, {
    ensureNetwork: reject,
    findNetwork: reject,
    hasGateway: reject,
    ensureSecurityGroups: reject,
    ensureLoadBalancer: reject,
    ensureServer: reject,
    deleteServer: reject,
    deleteByTag: reject,
    listClusterResources: reject,
    resolveImage: reject,
    resolveFlavor: reject
  })
}

// The token/retry/semaphore wrapper (`OpenStackHttpLive`) sits between the
// generated Nova/Neutron/Glance/Octavia clients and the ambient `HttpClient` —
// without it every call ships without `X-Auth-Token`.
const _liveCloudProvider = (
  { auth, options, region }: {
    readonly options: Omit<CloudProviderOptions, "region">
    readonly auth: NonNullable<OpenStackEnvShape["keystone"]>
    readonly region: string
  }
): Layer.Layer<CloudProvider, never, HttpClient.HttpClient> => {
  const keystone = Layer.succeed(KeystoneAuth, auth)
  return CloudProviderLive({ ...options, region }).pipe(
    Layer.provide(OpenStackHttpLive().pipe(Layer.provide(keystone))),
    Layer.provide(keystone)
  )
}

/**
 * The OpenStack `CloudProvider`, reusing the already-resolved `OpenStackEnv`
 * (shared with the doctor checks and `CinderAuth`) instead of re-deriving
 * Keystone auth. Fails at first use (never at Layer-build time) when OpenStack
 * credentials are missing, same contract as `OpenStackEnv`/`CinderAuthLive`.
 * `region` is the env's, so callers supply everything else.
 */
const _openStackCloudProviderLayer = (
  { octaviaEnabled, options }: {
    readonly options: Omit<CloudProviderOptions, "region" | "octaviaEnabled">
    /** Resolved against the env's region — the same region the Octavia client is looked up in. */
    readonly octaviaEnabled: (region: string) => boolean
  }
): OpenStackCloudProviderLayer =>
  Layer.unwrap(
    Effect.map(OpenStackEnv, (env) =>
      env.keystone === undefined || env.region === undefined
        ? _unavailableCloudProvider(env.unavailableReason ?? "OpenStack auth unavailable")
        : _liveCloudProvider({
          auth: env.keystone,
          options: { ...options, octaviaEnabled: octaviaEnabled(env.region) },
          region: env.region
        }))
  )

// N1: k3s keeps `api_server.high_availability` as its source. It gates apply,
// kubeconfig AND status unconditionally, so swapping it for a region lookup
// would silently change which k3s configs can boot.
export const k3sCloudProviderLayer = (config: K3sClusterConfig): OpenStackCloudProviderLayer =>
  _openStackCloudProviderLayer({
    options: { tag: config.name, imageAliases: {} },
    octaviaEnabled: () => config.api_server.high_availability
  })

/**
 * The same OpenStack `CloudProvider` for the ovh-mks path. MKS configs have no
 * `api_server` block, so `octaviaEnabled` comes from OVH's per-region Octavia
 * availability table (R11) — the honest answer to "can this region serve a load
 * balancer at all", and the one the doctor's Octavia probe already reports.
 */
export const mksCloudProviderLayer = (config: { readonly name: string }): OpenStackCloudProviderLayer =>
  _openStackCloudProviderLayer({ options: { tag: config.name, imageAliases: {} }, octaviaEnabled: hasOctavia })

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

// `upcloud-uks` never reaches the OpenStack `CloudProvider` port — its network
// is UpCloud's own SDN, converged directly by `distro-upcloud-uks` through
// `UpcloudEnv` (see `upcloud/reconcile.ts`), not this port. These three members
// exist only so `providerRegistry` stays a total `Record<ProviderKind, _>`;
// nothing on the `upcloud-uks` path ever calls them (only `kind`,
// `credentialsFromDistro` and `requiredEnvVars` are read generically, by
// `env-summary.ts`'s `providerSections`).
const _unavailableUpcloudCredential = (): Effect.Effect<never, AuthenticationFailed> =>
  Effect.fail(new AuthenticationFailed({ hint: "upcloud-uks has no OpenStack credential — see UpcloudEnv" }))

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
  },
  upcloud: {
    kind: "upcloud",
    cloudProviderLayer: () => _unavailableCloudProvider("upcloud-uks does not use the OpenStack CloudProvider port"),
    cloudCredential: _unavailableUpcloudCredential,
    secGroupRules: () => [],
    // Credentials come from the distro (UPCLOUD_API_TOKEN via UpcloudEnv) — same rationale as `_openStackEntry`.
    requiredEnvVars: [],
    credentialsFromDistro: true
  }
}

export const providerFor = (config: ClusterConfig): ProviderEntry => providerRegistry[config.provider]
