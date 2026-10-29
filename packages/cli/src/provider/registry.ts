import { Config, Effect, Layer, Redacted } from "effect"
import type * as HttpClient from "effect/http/HttpClient"
import { AuthenticationFailed, CloudProvider } from "@kumulo/core"
import type { Addon, SecGroupSpec } from "@kumulo/core"
import type { ClusterConfig, K3sClusterConfig } from "../cluster-config.ts"
import { buildFr57Rules, CloudProviderLive, KeystoneAuth, OpenStackHttpLive, openstackClusterAddons } from "@kumulo/openstack"
import type { CloudProviderOptions } from "@kumulo/openstack"
import { buildHetznerSecGroupRules, CloudProviderLive as HcloudCloudProviderLive, hcloudHttpClientLive, hetznerClusterAddons } from "@kumulo/hetzner"
import { hasOctavia } from "@kumulo/provider-ovh"
import { OpenStackEnv } from "../doctor-openstack/env.ts"
import type { OpenStackEnvService } from "../doctor-openstack/env.ts"
import { requiredRedactedEnv } from "../env.ts"

export type ProviderKind = ClusterConfig["provider"]

export interface ProviderEntry {
  readonly kind: ProviderKind
  readonly cloudProviderLayer: (
    config: K3sClusterConfig
  ) => Layer.Layer<CloudProvider, AuthenticationFailed, OpenStackEnv | HttpClient.HttpClient>
  readonly clusterAddons: (config: K3sClusterConfig) => Effect.Effect<ReadonlyArray<Addon>, AuthenticationFailed, OpenStackEnv>
  readonly secGroupRules: (config: K3sClusterConfig) => SecGroupSpec["rules"]
  readonly requiredEnvVars: ReadonlyArray<string>
  readonly credentialsFromDistro: boolean
}

type OpenStackCloudProviderLayer = Layer.Layer<CloudProvider, AuthenticationFailed, OpenStackEnv | HttpClient.HttpClient>

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

// landmine: skipping OpenStackHttpLive means calls ship without X-Auth-Token
const _liveCloudProvider = (
  { auth, options, region }: {
    readonly options: Omit<CloudProviderOptions, "region">
    readonly auth: NonNullable<OpenStackEnvService["keystone"]>
    readonly region: string
  }
): Layer.Layer<CloudProvider, never, HttpClient.HttpClient> => {
  const keystone = Layer.succeed(KeystoneAuth, auth)

  return CloudProviderLive({ ...options, region }).pipe(
    Layer.provide(OpenStackHttpLive().pipe(Layer.provide(keystone))),
    Layer.provide(keystone)
  )
}

const _openStackCloudProviderLayer = (
  { octaviaEnabled, options }: {
    readonly options: Omit<CloudProviderOptions, "region" | "octaviaEnabled">
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

export const k3sCloudProviderLayer = (config: K3sClusterConfig): OpenStackCloudProviderLayer =>
  _openStackCloudProviderLayer({
    options: { tag: config.name, imageAliases: {} },
    octaviaEnabled: () => config.api_server.high_availability
  })

export const mksCloudProviderLayer = (config: { readonly name: string }): OpenStackCloudProviderLayer =>
  _openStackCloudProviderLayer({ options: { tag: config.name, imageAliases: {} }, octaviaEnabled: hasOctavia })

export const hcloudHttpClientLayer = (): Layer.Layer<HttpClient.HttpClient, AuthenticationFailed, HttpClient.HttpClient> =>
  Layer.unwrap(Effect.map(requiredRedactedEnv("HCLOUD_TOKEN"), (token) => hcloudHttpClientLive(token)))

export const k3sHetznerCloudProviderLayer = (
  config: K3sClusterConfig
): Layer.Layer<CloudProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  HcloudCloudProviderLive({ tag: config.name, location: config.auth.region }).pipe(Layer.provide(hcloudHttpClientLayer()))

const _openStackClusterAddons = (config: K3sClusterConfig): Effect.Effect<ReadonlyArray<Addon>, AuthenticationFailed, OpenStackEnv> =>
  Effect.gen(function*() {
    const env = yield* OpenStackEnv
    const authUrl = yield* Config.String("OS_AUTH_URL").pipe(Config.withDefault(""))
    const applicationCredentialId = yield* Config.String("OS_APPLICATION_CREDENTIAL_ID").pipe(Config.withDefault(""))

    const applicationCredentialSecret = yield* Config.Redacted("OS_APPLICATION_CREDENTIAL_SECRET").pipe(
      Config.withDefault(Redacted.make(""))
    )

    return openstackClusterAddons({
      conf: {
        authUrl,
        region: env.region ?? "",
        applicationCredentialId,
        applicationCredentialSecret: Redacted.value(applicationCredentialSecret)
      },
      ccm: config.addons.cloud_controller_manager,
      csi: config.addons.csi.enabled ? { defaultVolumeType: config.addons.csi.default_volume_type } : false
    })
  }).pipe(Effect.orDie)

const _hetznerClusterAddons = (config: K3sClusterConfig): Effect.Effect<ReadonlyArray<Addon>, AuthenticationFailed> =>
  Effect.map(requiredRedactedEnv("HCLOUD_TOKEN"), (token) =>
    hetznerClusterAddons({ token: Redacted.value(token), ccm: config.addons.cloud_controller_manager, csi: config.addons.csi.enabled }))

const _ruleOptions = (config: K3sClusterConfig) => ({
  allowedSshCidrs: config.ssh.allowed_cidrs,
  allowedApiCidrs: config.api_server.allowed_cidrs,
  networkCidr: config.network.cidr,
  cni: config.addons.cni
})

const _openStackEntry = (kind: ProviderKind): ProviderEntry => ({
  kind,
  cloudProviderLayer: k3sCloudProviderLayer,
  clusterAddons: _openStackClusterAddons,
  secGroupRules: (config) => buildFr57Rules(_ruleOptions(config)),
  requiredEnvVars: [],
  credentialsFromDistro: true
})

const _unavailableUpcloudAddons = (): Effect.Effect<never, AuthenticationFailed> =>
  Effect.fail(new AuthenticationFailed({ hint: "upcloud-uks has no OpenStack credential — see UpcloudEnv" }))

export const providerRegistry: Record<ProviderKind, ProviderEntry> = {
  ovh: _openStackEntry("ovh"),
  generic: _openStackEntry("generic"),
  hetzner: {
    kind: "hetzner",
    cloudProviderLayer: k3sHetznerCloudProviderLayer,
    clusterAddons: _hetznerClusterAddons,
    secGroupRules: (config) => buildHetznerSecGroupRules(_ruleOptions(config)),
    requiredEnvVars: ["HCLOUD_TOKEN"],
    credentialsFromDistro: false
  },
  upcloud: {
    kind: "upcloud",
    cloudProviderLayer: () => _unavailableCloudProvider("upcloud-uks does not use the OpenStack CloudProvider port"),
    clusterAddons: _unavailableUpcloudAddons,
    secGroupRules: () => [],
    requiredEnvVars: [],
    credentialsFromDistro: true
  }
}

export const providerFor = (config: ClusterConfig): ProviderEntry => providerRegistry[config.provider]
