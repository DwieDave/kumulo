import { Config, Effect, Layer, Option } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import { ConfigInvalid, dnsNoopLive } from "@kumulo/core"
import type { AuthenticationFailed, DnsProvider } from "@kumulo/core"
import { makeDnsClient, ovhDnsProviderLive } from "@kumulo/dns-ovh"
import { hetznerDnsHttpLive, hetznerDnsProviderLive, makeHetznerDnsClient } from "@kumulo/dns-hetzner"
import { GodaddyHttpLive, godaddyDnsProviderLive, makeGodaddyDnsClient } from "@kumulo/dns-godaddy"
import { CloudflareHttpLive, cloudflareDnsProviderLive, makeCloudflareDnsClient } from "@kumulo/dns-cloudflare"
import { BunnyHttpLive, bunnyDnsClient } from "@kumulo/bunny"
import { bunnyDnsProviderLive } from "@kumulo/dns-bunny"
import type { ClusterConfig } from "../cluster-config.ts"
import { requiredRedactedEnv } from "../env.ts"
import { ovhHttpClientFromEnv } from "../provider/ovh-http.ts"

export type DnsModule = ClusterConfig["dns"]["module"]

export interface DnsLayerArgs {
  readonly ttl: number
  readonly pullZoneIdFor?: ((target: string) => number | undefined) | undefined
}

export type DnsLayer = Layer.Layer<DnsProvider, AuthenticationFailed | ConfigInvalid, HttpClient.HttpClient>

export interface DnsRegistryEntry {
  readonly envVars: ReadonlyArray<string>
  readonly layer: (args: DnsLayerArgs) => DnsLayer
}

const _optionalUrlEnv = (name: string): Effect.Effect<string | undefined, ConfigInvalid> =>
  Config.option(Config.String(name)).pipe(
    Effect.mapError((cause) => new ConfigInvalid({ issues: [{ path: [name], message: cause.message }] })),
    Effect.filterOrFail(
      (url) => Option.match(url, { onNone: () => true, onSome: (value) => URL.canParse(value) }),
      () => new ConfigInvalid({ issues: [{ path: [name], message: `${name} is not a valid URL` }] })
    ),
    Effect.map(Option.getOrUndefined)
  )

export const godaddyHttpClientFromEnv = (): Effect.Effect<
  HttpClient.HttpClient,
  AuthenticationFailed | ConfigInvalid,
  HttpClient.HttpClient
> =>
  Effect.gen(function*() {
    const token = yield* requiredRedactedEnv("GODADDY_API_TOKEN")
    const baseUrl = yield* _optionalUrlEnv("GODADDY_API_BASE_URL")

    return yield* Effect.provide(HttpClient.HttpClient, GodaddyHttpLive({ token, baseUrl }))
  })

export const cloudflareHttpClientFromEnv = (): Effect.Effect<
  HttpClient.HttpClient,
  AuthenticationFailed | ConfigInvalid,
  HttpClient.HttpClient
> =>
  Effect.gen(function*() {
    const token = yield* requiredRedactedEnv("CLOUDFLARE_API_TOKEN")
    const baseUrl = yield* _optionalUrlEnv("CLOUDFLARE_API_BASE_URL")

    return yield* Effect.provide(HttpClient.HttpClient, CloudflareHttpLive({ token, baseUrl }))
  })

export const dnsRegistry: Record<DnsModule, DnsRegistryEntry> = {
  none: { envVars: [], layer: () => dnsNoopLive },
  ovh: {
    envVars: ["OVH_CLIENT_ID", "OVH_CLIENT_SECRET"],
    layer: () =>
      Layer.unwrap(
        Effect.gen(function*() {
          const httpClient = yield* Effect.provide(HttpClient.HttpClient, ovhHttpClientFromEnv())

          return ovhDnsProviderLive(makeDnsClient(httpClient))
        })
      )
  },
  hetzner: {
    envVars: ["HETZNER_DNS_TOKEN"],
    layer: ({ ttl }) =>
      Layer.unwrap(
        Effect.gen(function*() {
          const token = yield* requiredRedactedEnv("HETZNER_DNS_TOKEN")
          const httpClient = yield* Effect.provide(HttpClient.HttpClient, hetznerDnsHttpLive({ token }))

          return hetznerDnsProviderLive({ dns: makeHetznerDnsClient(httpClient), ttl })
        })
      )
  },
  bunny: {
    envVars: ["BUNNYNET_API_KEY"],
    layer: ({ pullZoneIdFor, ttl }) =>
      Layer.unwrap(
        Effect.gen(function*() {
          const apiKey = yield* requiredRedactedEnv("BUNNYNET_API_KEY")
          const httpClient = yield* Effect.provide(HttpClient.HttpClient, BunnyHttpLive({ apiKey }))

          return bunnyDnsProviderLive({ dns: bunnyDnsClient({ httpClient }), pullZoneIdFor, ttl })
        })
      )
  },
  godaddy: {
    envVars: ["GODADDY_API_TOKEN"],
    layer: ({ ttl }) =>
      Layer.unwrap(
        Effect.gen(function*() {
          const httpClient = yield* godaddyHttpClientFromEnv()

          return godaddyDnsProviderLive({ dns: makeGodaddyDnsClient(httpClient), ttl })
        })
      )
  },
  cloudflare: {
    envVars: ["CLOUDFLARE_API_TOKEN"],
    layer: ({ ttl }) =>
      Layer.unwrap(
        Effect.gen(function*() {
          const httpClient = yield* cloudflareHttpClientFromEnv()

          return cloudflareDnsProviderLive({ dns: makeCloudflareDnsClient(httpClient), ttl })
        })
      )
  }
}
