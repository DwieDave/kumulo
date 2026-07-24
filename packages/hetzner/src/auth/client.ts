import { Effect, Layer, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

/** Hetzner Cloud API base URL — everything (incl. DNS) lives here, Bearer-token auth. */
export const HCLOUD_API_BASE_URL = "https://api.hetzner.cloud/v1"

// kumulo: unlike OVH's OAuth2 token (OvhAuthLive), an hcloud API token is a
// static project secret that never expires (D4) — no Ref/cache/expiry-skew
// machinery needed, just a per-request Bearer header.
const _isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || (status >= 500 && status < 600)

const _headerSeconds = (response: HttpClientResponse.HttpClientResponse, name: string): number | undefined => {
  const value = response.headers[name]
  if (value === undefined) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds : undefined
}

// kumulo: `Retry-After` is a relative delay in seconds; `RateLimit-Reset` is an
// absolute UNIX timestamp in seconds (R5) — both normalized to a millis delay
// from now, `Retry-After` taking precedence when both are present.
const _explicitDelayMillis = (response: HttpClientResponse.HttpClientResponse): number | undefined => {
  const retryAfter = _headerSeconds(response, "retry-after")
  if (retryAfter !== undefined) return retryAfter * 1000
  const reset = _headerSeconds(response, "ratelimit-reset")
  return reset === undefined ? undefined : Math.max(0, reset * 1000 - Date.now())
}

const hcloudMaxRetries = 5

const _backoffMillis = (attempt: number): number => Math.min(200 * 2 ** attempt, 10_000) * (0.5 + Math.random() * 0.5)

// kumulo: hand-rolled loop, not a `Schedule` combinator — the delay depends on
// the *previous response's* headers (Retry-After/RateLimit-Reset), which a pure
// delay `Schedule` can't inspect. Mirrors how effect's own `HttpClient.withRateLimiter`
// implements the same "adaptive learning from Retry-After" behavior internally.
// Re-running `effect` (an Effect *description*, not a promise) re-issues the
// underlying request — the same trick `HttpClient.retryTransient` uses.
const _withRetry = (
  effect: Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
  attempt: number
): Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError> =>
  effect.pipe(
    Effect.flatMap((response) => {
      if (!_isRetryableStatus(response.status) || attempt >= hcloudMaxRetries) return Effect.succeed(response)
      const delayMillis = _explicitDelayMillis(response) ?? _backoffMillis(attempt)
      return Effect.sleep(`${Math.round(delayMillis)} millis`).pipe(Effect.flatMap(() => _withRetry(effect, attempt + 1)))
    })
  )

const _addAuth = (token: Redacted.Redacted<string>) =>
(request: HttpClientRequest.HttpClientRequest): HttpClientRequest.HttpClientRequest =>
  HttpClientRequest.bearerToken(request, Redacted.value(token))

/**
 * Wraps a base `HttpClient` with Bearer-token injection and a bounded 429/5xx
 * retry (R5). `provider/rest.ts`'s `hcloudRequest` already builds absolute
 * URLs itself, so no `prependUrl` step is needed here — transforms the
 * *base* client (via `mapRequest`/`transformResponse`) rather than rebuilding
 * one from scratch with `HttpClient.make`, which would re-validate
 * `request.url` at the wrong point in the pipeline.
 */
export const hcloudHttpClientLayer = (
  token: Redacted.Redacted<string>
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (base) =>
      base.pipe(
        HttpClient.mapRequest(_addAuth(token)),
        HttpClient.transformResponse((effect) => _withRetry(effect, 0))
      ))
  )
