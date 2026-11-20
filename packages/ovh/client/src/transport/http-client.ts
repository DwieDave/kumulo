import { Effect, Layer } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { makeProviderHttpClient } from "@kumulo/core"
import { OvhAuth } from "../auth/port.ts"

export const OVH_API_BASE_URL = "https://eu.api.ovh.com/1.0"

// No filterStatusOk: generated clients match statuses themselves and capture OVH's JSON error body, filtering first would lose it.
export const ovhHttpClientLive = (
  baseUrl: string = OVH_API_BASE_URL
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient | OvhAuth> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const base = yield* HttpClient.HttpClient
      const auth = yield* OvhAuth

      // baseUrl is applied outside: core's client builds on HttpClient.make, which rejects a relative url before baseUrl is prepended
      const client = yield* makeProviderHttpClient({
        base,
        // OVH rate-limits per application; keep the fan-out modest
        maxConcurrentRequests: 8,
        authorize: (request) =>
          auth.token.pipe(
            Effect.map((token) => HttpClientRequest.bearerToken(request, token)),
            Effect.catchTag("AuthenticationFailed", (authError) =>
              Effect.fail(
                new HttpClientError.HttpClientError({
                  reason: new HttpClientError.TransportError({ request, cause: authError, description: authError.hint })
                })
              ))
          )
      })

      return HttpClient.mapRequest(client, HttpClientRequest.prependUrl(baseUrl))
    })
  )
