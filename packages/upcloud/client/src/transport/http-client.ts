import { Effect, Layer } from "effect"
import type { Duration, Redacted } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { makeProviderHttpClient } from "@kumulo/core"

export const UPCLOUD_API_BASE_URL = "https://api.upcloud.com"

export interface UpcloudHttpClientOptions {
  readonly base: HttpClient.HttpClient
  readonly token: Redacted.Redacted<string>
  readonly baseUrl?: string
  readonly requestTimeout?: Duration.Input
}

export const makeUpcloudHttpClient = (options: UpcloudHttpClientOptions): Effect.Effect<HttpClient.HttpClient> =>
  Effect.map(
    makeProviderHttpClient({
      base: options.base,
      authorize: (request) => Effect.succeed(HttpClientRequest.bearerToken(request, options.token)),
      timeout: options.requestTimeout
    }),
    // HttpClient.make parses the URL before the handler runs, so a relative path must be prefixed on the outside
    HttpClient.mapRequest(HttpClientRequest.prependUrl(options.baseUrl ?? UPCLOUD_API_BASE_URL))
  )

export const UpcloudHttpLive = (
  { token, baseUrl }: { readonly token: Redacted.Redacted<string>; readonly baseUrl?: string }
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(HttpClient.HttpClient, Effect.flatMap(HttpClient.HttpClient, (base) => makeUpcloudHttpClient({ base, token, baseUrl })))
