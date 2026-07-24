import { Effect, Layer } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { AuthenticationFailed } from "@kumulo/core"
import type { ClusterConfig } from "@kumulo/core"
import { buildFr57Rules, CloudProviderLive, KeystoneAuth } from "@kumulo/openstack"
import type { CloudProviderOptions } from "@kumulo/openstack"
import { makeDnsClient, ovhDnsProviderLive } from "@kumulo/dns-ovh"
import { CinderAuth, VolumeProviderLive } from "@kumulo/volumes-cinder"
import type { VolumeProviderOptions } from "@kumulo/volumes-cinder"
import { OvhAuthLive, ovhHttpClientLayer } from "@kumulo/provider-ovh"
import { OpenStackEnv } from "../doctor-openstack/env.ts"

const _requiredEnv = (name: string): Effect.Effect<string, AuthenticationFailed> => {
  const value = process.env[name]
  return value === undefined || value.length === 0
    ? Effect.fail(new AuthenticationFailed({ hint: `missing required env var ${name}` }))
    : Effect.succeed(value)
}

/** FR-5.7 — security-group rules for this cluster's network CIDR/allowed CIDRs/CNI choice. */
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
 * FR-3.1/FR-5.7 — the k3s composition root's `CloudProvider`, reusing the
 * already-resolved `OpenStackEnv` (T6.3, shared with the doctor checks and
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

/** FR-8 — same Cinder-backed `VolumeProvider` construction as `commands/volumes.ts`'s `reconcileVolumesOnDelete`. */
export const k3sVolumeProviderLayer = (
  options: VolumeProviderOptions
): Layer.Layer<import("@kumulo/core").VolumeProvider, never, CinderAuth | HttpClient.HttpClient> => VolumeProviderLive(options)

/**
 * FR-7 — `dns-ovh`'s `DnsProvider`, built from the same OVH OAuth2
 * client-credentials env vars as `MksEnv` (one OVH account, shared by
 * whichever distro's config asks for `dns.module: ovh`).
 */
export const k3sDnsProviderLayer = (): Layer.Layer<import("@kumulo/core").DnsProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function*() {
      const clientId = yield* _requiredEnv("OVH_CLIENT_ID")
      const clientSecret = yield* _requiredEnv("OVH_CLIENT_SECRET")
      const authLayer = OvhAuthLive({ clientId, clientSecret })
      const httpClientLayer = ovhHttpClientLayer().pipe(Layer.provide(authLayer))
      const httpClient = yield* Effect.provide(HttpClient.HttpClient, httpClientLayer)
      return ovhDnsProviderLive(makeDnsClient(httpClient))
    })
  )
