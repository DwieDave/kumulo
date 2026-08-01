import { Effect, Layer } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { OvhAuth } from "./port.ts"

export const OVH_API_BASE_URL = "https://eu.api.ovh.com/1.0"

export const ovhHttpClientLive = (
  baseUrl: string = OVH_API_BASE_URL
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient | OvhAuth> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      const base = yield* HttpClient.HttpClient
      const auth = yield* OvhAuth
      return base.pipe(
        HttpClient.mapRequestEffect((request) =>
          auth.token.pipe(
            Effect.map((token) => request.pipe(HttpClientRequest.bearerToken(token), HttpClientRequest.prependUrl(baseUrl))),
            Effect.catchTag("AuthenticationFailed", (authError) =>
              Effect.fail(
                new HttpClientError.HttpClientError({
                  reason: new HttpClientError.TransportError({ request, cause: authError, description: authError.hint })
                })
              ))
          )
        )
        // No filterStatusOk: generated clients match statuses themselves and capture OVH's JSON error body, filtering first would lose it.
      )
    })
  )
