import { Effect, Layer, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

export const HCLOUD_API_BASE_URL = "https://api.hetzner.cloud/v1"

const _isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || (status >= 500 && status < 600)

const _headerSeconds = (response: HttpClientResponse.HttpClientResponse, name: string): number | undefined => {
  const value = response.headers[name]
  if (value === undefined) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds : undefined
}

// Retry-After is a relative delay in seconds; RateLimit-Reset is an absolute unix timestamp — Retry-After wins when both are present.
const _explicitDelayMillis = (response: HttpClientResponse.HttpClientResponse): number | undefined => {
  const retryAfter = _headerSeconds(response, "retry-after")
  if (retryAfter !== undefined) return retryAfter * 1000
  const reset = _headerSeconds(response, "ratelimit-reset")
  return reset === undefined ? undefined : Math.max(0, reset * 1000 - Date.now())
}

const hcloudMaxRetries = 5

const _backoffMillis = (attempt: number): number => Math.min(200 * 2 ** attempt, 10_000) * (0.5 + Math.random() * 0.5)

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

export const hcloudHttpClientLive = (
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
