import { Effect, Layer, Redacted } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { makeProviderHttpClient } from "@kumulo/core"

export const HETZNER_API_BASE_URL = "https://api.hetzner.cloud/v1"

// Same policy as the @kumulo/hetzner cloud client (same API host): core retries idempotent methods only, never POST/PATCH.
export const makeHetznerHttpClient = (
  options: { readonly base: HttpClient.HttpClient; readonly token: Redacted.Redacted<string>; readonly baseUrl?: string }
): Effect.Effect<HttpClient.HttpClient> =>
  Effect.map(
    makeProviderHttpClient({
      base: options.base,
      authorize: (request) => Effect.succeed(HttpClientRequest.bearerToken(request, Redacted.value(options.token))),
      retry: { statuses: [408, 429, 500, 502, 503, 504] }
    }),
    // the base URL is prepended outside core's client: HttpClient.make rejects a relative URL before the core runner sees it
    HttpClient.mapRequest(HttpClientRequest.prependUrl(options.baseUrl ?? HETZNER_API_BASE_URL))
  )

export const hetznerDnsHttpLive = (
  { baseUrl, token }: { readonly token: Redacted.Redacted<string>; readonly baseUrl?: string }
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.flatMap(HttpClient.HttpClient, (base) => makeHetznerHttpClient({ base, token, baseUrl }))
  )
