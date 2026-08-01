import type { Redacted } from "effect";
import { Context, Effect, Layer } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type { AuthenticationFailed } from "@kumulo/core"
import type { DnsProvider, VolumeProvider } from "@kumulo/core"
import type { ClusterConfig, K3sClusterConfig } from "../cluster-config.ts"
import { makeDnsClient, ovhDnsProviderLive } from "@kumulo/dns-ovh"
import { HetznerHttpLive, hetznerDnsProviderLive, makeHetznerDnsClient } from "@kumulo/dns-hetzner"
import { VolumeProviderLive } from "@kumulo/volumes-cinder"
import type { VolumeProviderOptions , CinderAuth} from "@kumulo/volumes-cinder"
import { VolumeProviderLive as HcloudVolumeProviderLive } from "@kumulo/hetzner"
import type { OpenStackEnv } from "../doctor-openstack/env.ts"
import { requiredRedactedEnv } from "../env.ts"
import { hcloudHttpClientLayer, providerFor } from "../provider/registry.ts"
import { ovhHttpClientFromEnv } from "../mks/env.ts"

export const secGroupRules = (config: K3sClusterConfig) => providerFor(config).secGroupRules(config)

export const k3sVolumeProviderLayer = (
  options: VolumeProviderOptions
): Layer.Layer<VolumeProvider, never, CinderAuth | HttpClient.HttpClient> => VolumeProviderLive(options)

export const k3sDnsProviderLayer = (): Layer.Layer<DnsProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function*() {
      const httpClient = yield* Effect.provide(HttpClient.HttpClient, ovhHttpClientFromEnv())
      return ovhDnsProviderLive(makeDnsClient(httpClient))
    })
  )

export const k3sHetznerDnsProviderLayer = (): Layer.Layer<DnsProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function*() {
      const token = yield* requiredRedactedEnv("HETZNER_DNS_TOKEN")
      const httpClient = yield* Effect.provide(HttpClient.HttpClient, HetznerHttpLive({ token }))
      return hetznerDnsProviderLive(makeHetznerDnsClient(httpClient))
    })
  )

export const k3sHetznerVolumeProviderLayer = (
  config: ClusterConfig
): Layer.Layer<VolumeProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  HcloudVolumeProviderLive({ tag: config.name, location: config.auth.region }).pipe(Layer.provide(hcloudHttpClientLayer()))

export type CloudCredentialShape =
  | {
    readonly provider: "openstack"
    readonly authUrl: string
    readonly region: string
    readonly applicationCredentialId: string
    readonly applicationCredentialSecret: string
  }
  | { readonly provider: "hetzner"; readonly token: Redacted.Redacted<string> }

export class CloudCredentialEnv extends Context.Service<CloudCredentialEnv, CloudCredentialShape>()("@kumulo/cli/CloudCredentialEnv") {}

export const k3sCloudCredentialLayer = (
  config: K3sClusterConfig
): Layer.Layer<CloudCredentialEnv, AuthenticationFailed, OpenStackEnv> =>
  Layer.effect(CloudCredentialEnv, providerFor(config).cloudCredential(config))
