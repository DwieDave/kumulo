import { Effect, Layer, Redacted } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { makeProviderHttpClient } from "@kumulo/core"

export const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4"

export interface CloudflareHttpClientOptions {
  readonly base: HttpClient.HttpClient
  readonly token: Redacted.Redacted<string>
  readonly baseUrl?: string
}

// Applied before the core client: HttpClient.make rejects a relative URL before core's own baseUrl step runs.
const _prefix = (baseUrl: string) =>
  (request: HttpClientRequest.HttpClientRequest): HttpClientRequest.HttpClientRequest =>
    URL.canParse(request.url) ? request : HttpClientRequest.prependUrl(request, baseUrl)

// Core retries GET, PUT and DELETE only, so a POST that timed out is never sent twice;
// a duplicate that slips through anyway is collapsed by the next reconcile.
export const makeCloudflareHttpClient = (options: CloudflareHttpClientOptions): Effect.Effect<HttpClient.HttpClient> =>
  Effect.map(
    makeProviderHttpClient({
      base: options.base,
      authorize: (request) =>
        Effect.succeed(HttpClientRequest.setHeader(request, "Authorization", `Bearer ${Redacted.value(options.token)}`))
    }),
    (client) => HttpClient.mapRequest(client, _prefix(options.baseUrl ?? CLOUDFLARE_API_BASE_URL))
  )

export const CloudflareHttpLive = (
  { baseUrl, token }: { readonly token: Redacted.Redacted<string>; readonly baseUrl?: string | undefined }
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.flatMap(HttpClient.HttpClient, (base) =>
      makeCloudflareHttpClient(baseUrl === undefined ? { base, token } : { base, token, baseUrl }))
  )
