import { Effect, Layer, Redacted } from "effect"
import type { Duration } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { makeProviderHttpClient } from "@kumulo/core"

export const BUNNY_API_BASE_URL = "https://api.bunny.net"

export interface BunnyHttpClientOptions {
  readonly base: HttpClient.HttpClient
  readonly apiKey: Redacted.Redacted<string>
  readonly baseUrl?: string
  readonly retryBaseDelay?: Duration.Input
}

const _withBaseUrl = (
  { baseUrl, request }: { readonly request: HttpClientRequest.HttpClientRequest; readonly baseUrl: string }
): HttpClientRequest.HttpClientRequest => URL.canParse(request.url) ? request : HttpClientRequest.prependUrl(request, baseUrl)

// POST/PUT/PATCH are never auto-retried (bunny PUT /records creates a record); 429 and 5xx on GET/HEAD/DELETE/OPTIONS are.
// The base URL is applied outside the core client because HttpClient.make parses the URL before its handler runs.
export const makeBunnyHttpClient = (options: BunnyHttpClientOptions): Effect.Effect<HttpClient.HttpClient> => {
  const baseUrl = options.baseUrl ?? BUNNY_API_BASE_URL

  return makeProviderHttpClient({
    base: options.base,
    retry: { methods: ["GET", "HEAD", "DELETE", "OPTIONS"], baseDelay: options.retryBaseDelay },
    authorize: (request) => Effect.succeed(HttpClientRequest.setHeader(request, "AccessKey", Redacted.value(options.apiKey)))
  }).pipe(Effect.map(HttpClient.mapRequest((request) => _withBaseUrl({ request, baseUrl }))))
}

export const BunnyHttpLive = (
  { apiKey, baseUrl }: { readonly apiKey: Redacted.Redacted<string>; readonly baseUrl?: string }
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.flatMap(HttpClient.HttpClient, (base) => makeBunnyHttpClient({ base, apiKey, baseUrl }))
  )
