import { Effect, Layer, Redacted } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { makeProviderHttpClient } from "@kumulo/core"

export const HCLOUD_API_BASE_URL = "https://api.hetzner.cloud/v1"

// POST/PATCH are never retried (core default: idempotent methods only); a replayed server create would bill a duplicate server.
export const hcloudHttpClientLive = (
  token: Redacted.Redacted<string>
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.flatMap(HttpClient.HttpClient, (base) =>
      makeProviderHttpClient({
        base,
        authorize: (request) => Effect.succeed(HttpClientRequest.bearerToken(request, Redacted.value(token))),
        retry: { statuses: [408, 429, 500, 502, 503, 504] }
      }))
  )
