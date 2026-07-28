/**
 * Static-bearer-token auth + retry-on-429/5xx transport wrapper (R1, R6).
 * UpCloud API tokens are static (D1 — hand-written client, no OAuth2 dance),
 * so the token is read once at Layer construction and never logged: only
 * `Redacted.value` unwraps it, and only inside the request builder.
 *
 * kumulo: same exp-backoff+jitter shape as `dns-hetzner/transport/http-client.ts`'s
 * `transportRetrySchedule` — dependency-cruiser forbids importing a sibling
 * package's `src/` internals, so the constants are copied here, not shared.
 */
import { Effect, Layer, Schedule } from "effect"
import type { Duration, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"

export const UPCLOUD_API_BASE_URL = "https://api.upcloud.com"

const _isRetryableStatus = (status: number): boolean => status === 429 || (status >= 500 && status < 600)

export const transportRetrySchedule: Schedule.Schedule<Duration.Duration> = Schedule.exponential("200 millis", 2).pipe(
  Schedule.jittered
)
export const transportMaxRetries = 5

export interface UpcloudHttpClientOptions {
  readonly base: HttpClient.HttpClient
  readonly token: Redacted.Redacted<string>
  readonly baseUrl?: string
}

/** Wraps a base `HttpClient` with Bearer-token injection + the UpCloud API base URL, plus bounded retry-on-429/5xx. */
export const makeUpcloudHttpClient = (options: UpcloudHttpClientOptions): HttpClient.HttpClient => {
  const baseUrl = options.baseUrl ?? UPCLOUD_API_BASE_URL
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

/** `HttpClient.HttpClient` in, wrapped `HttpClient.HttpClient` out — feeds straight into a generated/hand-written UpCloud client. */
export const UpcloudHttpLive = (
  { token, baseUrl }: { readonly token: Redacted.Redacted<string>; readonly baseUrl?: string }
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(HttpClient.HttpClient, Effect.map(HttpClient.HttpClient, (base) => makeUpcloudHttpClient({ base, token, baseUrl })))
