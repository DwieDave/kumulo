import { Effect, Layer } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { OvhAuth } from "./port.ts"

/** OVH API v1 base URL (design §4.5 — MKS `kube`/`nodepool`, DNS `domain/zone` routes). */
export const OVH_API_BASE_URL = "https://eu.api.ovh.com/1.0"

/**
 * Wraps a base `HttpClient` with Bearer-token injection (via `OvhAuth`) and the
 * OVH API base URL — feed the resulting client straight into a generated
 * client's `make(httpClient)` (distro-ovh-mks's `Mks`, dns-ovh's `Dns`).
 */
export const ovhHttpClientLayer = (
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
            // kumulo: the plain `HttpClient` interface fixes its error channel to
            // `HttpClientError` — wrap a token-fetch `AuthenticationFailed` as the
            // request-phase equivalent (`TransportError`, cause carries the
            // original tagged error for callers that want to unwrap it).
            Effect.catchTag("AuthenticationFailed", (authError) =>
              Effect.fail(
                new HttpClientError.HttpClientError({
                  reason: new HttpClientError.TransportError({ request, cause: authError, description: authError.hint })
                })
              ))
          )
        ),
        HttpClient.filterStatusOk
      )
    })
  )
