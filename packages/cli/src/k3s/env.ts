import { Config, Effect, Layer, Option } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import { ConfigInvalid } from "@kumulo/core"
import type { AuthenticationFailed } from "@kumulo/core"
import type { DnsProvider, VolumeProvider } from "@kumulo/core"
import type { ClusterConfig, K3sClusterConfig } from "../cluster-config.ts"
import { makeDnsClient, ovhDnsProviderLive } from "@kumulo/dns-ovh"
import { HetznerHttpLive, hetznerDnsProviderLive, makeHetznerDnsClient } from "@kumulo/dns-hetzner"
import { GodaddyHttpLive, godaddyDnsProviderLive, makeGodaddyDnsClient } from "@kumulo/dns-godaddy"
import { BunnyHttpLive, bunnyDnsClient } from "@kumulo/bunny"
import { bunnyDnsProviderLive } from "@kumulo/dns-bunny"
import { VolumeProviderLive } from "@kumulo/volumes-cinder"
import type { VolumeProviderOptions , CinderAuth} from "@kumulo/volumes-cinder"
import { VolumeProviderLive as HcloudVolumeProviderLive } from "@kumulo/hetzner"
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

export const godaddyHttpClientFromEnv = (): Effect.Effect<
  HttpClient.HttpClient,
  AuthenticationFailed | ConfigInvalid,
  HttpClient.HttpClient
> =>
  Effect.gen(function*() {
    const token = yield* requiredRedactedEnv("GODADDY_API_TOKEN")

    const baseUrl = yield* Config.option(Config.String("GODADDY_API_BASE_URL")).pipe(
      Effect.mapError((cause) => new ConfigInvalid({ issues: [{ path: ["GODADDY_API_BASE_URL"], message: cause.message }] })),
      Effect.filterOrFail(
        (url) => Option.match(url, { onNone: () => true, onSome: (value) => URL.canParse(value) }),
        () => new ConfigInvalid({ issues: [{ path: ["GODADDY_API_BASE_URL"], message: "GODADDY_API_BASE_URL is not a valid URL" }] })
      )
    )

    return yield* Effect.provide(HttpClient.HttpClient, GodaddyHttpLive({ token, baseUrl: Option.getOrUndefined(baseUrl) }))
  })

export const k3sGodaddyDnsProviderLayer = (
  { ttl }: { readonly ttl: number }
): Layer.Layer<DnsProvider, AuthenticationFailed | ConfigInvalid, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function*() {
      const httpClient = yield* godaddyHttpClientFromEnv()

      return godaddyDnsProviderLive({ dns: makeGodaddyDnsClient(httpClient), ttl })
    })
  )

export const k3sBunnyDnsProviderLayer = (
  { pullZoneIdFor, ttl }: {
    readonly pullZoneIdFor?: ((target: string) => number | undefined) | undefined
    readonly ttl: number
  }
): Layer.Layer<DnsProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function*() {
      const apiKey = yield* requiredRedactedEnv("BUNNYNET_API_KEY")
      const httpClient = yield* Effect.provide(HttpClient.HttpClient, BunnyHttpLive({ apiKey }))

      return bunnyDnsProviderLive({ dns: bunnyDnsClient({ httpClient }), pullZoneIdFor, ttl })
    })
  )

export const k3sHetznerVolumeProviderLayer = (
  config: ClusterConfig
): Layer.Layer<VolumeProvider, AuthenticationFailed, HttpClient.HttpClient> =>
  HcloudVolumeProviderLive({ tag: config.name, location: config.auth.region }).pipe(Layer.provide(hcloudHttpClientLayer()))
