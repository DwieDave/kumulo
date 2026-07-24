/**
 * Static-bearer-token auth + retry-on-429/5xx transport wrapper (R7, N2, D3,
 * D4). No token cache/refresh Layer — Hetzner Cloud API tokens are static
 * (D3), so the token is read once at Layer construction, unlike
 * `provider-ovh`'s OAuth2 client-credentials exchange.
 *
 * kumulo: same exp-backoff+jitter shape as `openstack/transport/http-client.ts`'s
 * `transportRetrySchedule` — dependency-cruiser forbids importing a sibling
 * package's `src/` internals, so the constants are copied here, not shared.
 */
import { Effect, Layer, Schedule } from "effect"
import type { Duration, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"

export const HETZNER_API_BASE_URL = "https://api.hetzner.cloud/v1"

const _isRetryableStatus = (status: number): boolean => status === 429 || (status >= 500 && status < 600)

export const transportRetrySchedule: Schedule.Schedule<Duration.Duration> = Schedule.exponential("200 millis", 2).pipe(
  Schedule.jittered
)
export const transportMaxRetries = 5

export interface HetznerHttpClientOptions {
  readonly base: HttpClient.HttpClient
  readonly token: Redacted.Redacted<string>
  readonly baseUrl?: string
}

/** Wraps a base `HttpClient` with Bearer-token injection + the Hetzner Cloud API base URL, plus bounded retry-on-429/5xx. */
export const makeHetznerHttpClient = (options: HetznerHttpClientOptions): HttpClient.HttpClient => {
  const baseUrl = options.baseUrl ?? HETZNER_API_BASE_URL
  const authed = options.base.pipe(
    HttpClient.mapRequest((request) => request.pipe(HttpClientRequest.bearerToken(options.token), HttpClientRequest.prependUrl(baseUrl)))
  )
  const schedule = Schedule.passthrough(transportRetrySchedule)
  // kumulo: `HttpClient.transformResponse` wraps the base client's response
  // effect in place — reusing its existing request/URL-resolution pipeline —
  // rather than reconstructing a client from scratch via `HttpClient.make`,
  // which would need an already-absolute request URL before this layer ever
  // gets to prepend one.
  return HttpClient.transformResponse(
    authed,
    (effect) => Effect.repeat(effect, { schedule, times: transportMaxRetries, while: (response) => _isRetryableStatus(response.status) })
  )
}

/** `HttpClient.HttpClient` in, wrapped `HttpClient.HttpClient` out — feeds straight into `makeHetznerDnsClient`. */
export const HetznerHttpLive = (
  { token, baseUrl }: { readonly token: Redacted.Redacted<string>; readonly baseUrl?: string }
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(HttpClient.HttpClient, Effect.map(HttpClient.HttpClient, (base) => makeHetznerHttpClient({ base, token, baseUrl })))
