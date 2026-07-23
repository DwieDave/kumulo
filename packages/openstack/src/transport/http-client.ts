import { KeystoneAuth } from "../auth/keystone-auth.ts"
import { Effect, Layer, Schedule, Semaphore } from "effect"
import type { Duration } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/unstable/http"

// kumulo: pinned per design §4.3 (T5.1 decision) — sent explicitly on every
// request rather than relying on Nova's "latest" default.
export const NOVA_API_MICROVERSION = "2.79"

const _isRetryableStatus = (status: number): boolean => status === 409 || status === 429 || (status >= 500 && status < 600)

// kumulo: exp backoff + jitter, FR-4.6 — retry-on 409/429/5xx handled below
// via response-status inspection, not by decoding a downstream error tag
// (that decoding is generated-client territory, T5.2).
export const transportRetrySchedule: Schedule.Schedule<Duration.Duration> = Schedule.exponential("200 millis", 2).pipe(
  Schedule.jittered
)
export const transportMaxRetries = 5

const _authError = (
  request: HttpClientRequest.HttpClientRequest,
  cause: unknown,
  description: string
): HttpClientError.HttpClientError =>
  new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, cause, description }) })

export interface OpenStackHttpClientOptions {
  readonly base: HttpClient.HttpClient
  readonly maxConcurrentRequests?: number
}

// kumulo: X-Auth-Token injection, one-shot re-auth on 401, exp-backoff retry
// on 409/429/5xx, and a Semaphore bounding request concurrency (FR-4.5-4.6).
export const makeOpenStackHttpClient = (
  options: OpenStackHttpClientOptions
): Effect.Effect<HttpClient.HttpClient, never, KeystoneAuth> =>
  Effect.gen(function*() {
    const base = options.base
    const auth = yield* KeystoneAuth
    const semaphore = yield* Semaphore.make(options.maxConcurrentRequests ?? 8)
    const schedule = Schedule.passthrough(transportRetrySchedule)
    const times = transportMaxRetries

    const attempt = (request: HttpClientRequest.HttpClientRequest) =>
      Effect.gen(function*() {
        const token = yield* auth.token.pipe(
          Effect.mapError((cause) => _authError(request, cause, "keystone token unavailable"))
        )
        const authed = HttpClientRequest.setHeaders(request, {
          "X-Auth-Token": token,
          "X-OpenStack-Nova-API-Version": NOVA_API_MICROVERSION
        })
        return yield* base.execute(authed)
      })

    const withReauth = (request: HttpClientRequest.HttpClientRequest) =>
      Effect.gen(function*() {
        const response = yield* attempt(request)
        if (response.status !== 401) return response
        yield* auth.invalidate
        return yield* attempt(request)
      })

    return HttpClient.make((request, _url, _signal, _fiber) =>
      semaphore.withPermit(
        Effect.repeat(withReauth(request), { schedule, times, while: (response) => _isRetryableStatus(response.status) })
      )
    )
  })

// kumulo: `HttpClient.HttpClient` in, wrapped `HttpClient.HttpClient` out —
// generated per-service clients (T5.2) depend on the same standard tag, so
// nothing downstream needs to know this layer exists.
export const OpenStackHttpLive = (
  options: { readonly maxConcurrentRequests?: number } = {}
): Layer.Layer<HttpClient.HttpClient, never, KeystoneAuth | HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.flatMap(HttpClient.HttpClient, (base) => makeOpenStackHttpClient({ base, ...options }))
  )
