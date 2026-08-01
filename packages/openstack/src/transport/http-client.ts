import { KeystoneAuth } from "../auth/keystone-auth.ts"
import { Effect, Layer, Schedule, Semaphore } from "effect"
import type { Duration } from "effect"
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/unstable/http"
import type { HttpClientResponse } from "effect/unstable/http"

export const NOVA_API_MICROVERSION = "2.79"

// only idempotent methods retry on 409/5xx — a retried POST /servers would double-provision
const _idempotent: ReadonlySet<string> = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"])

const _isRetryable = (method: string, status: number): boolean =>
  status === 429 || (_idempotent.has(method) && (status === 409 || (status >= 500 && status < 600)))

export const DEFAULT_REQUEST_TIMEOUT: Duration.Input = "30 seconds"

export const transportRetrySchedule: Schedule.Schedule<Duration.Duration> = Schedule.exponential("200 millis", 2).pipe(
  Schedule.jittered
)
export const transportMaxRetries = 5

const _BODY_LIMIT = 512

export const failNon2xx = HttpClient.transformResponse(
  Effect.flatMap((response: HttpClientResponse.HttpClientResponse) =>
    response.status >= 200 && response.status < 300
      ? Effect.succeed(response)
      : Effect.flatMap(Effect.orElseSucceed(response.text, () => ""), (body) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.StatusCodeError({
              request: response.request,
              response,
              description: body.slice(0, _BODY_LIMIT)
            })
          })
        ))
  )
)

const _authError = (
  request: HttpClientRequest.HttpClientRequest,
  cause: unknown,
  description: string
): HttpClientError.HttpClientError =>
  new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request, cause, description }) })

export interface OpenStackHttpClientOptions {
  readonly base: HttpClient.HttpClient
  readonly maxConcurrentRequests?: number
  readonly requestTimeout?: Duration.Input
}

export const makeOpenStackHttpClient = (
  options: OpenStackHttpClientOptions
): Effect.Effect<HttpClient.HttpClient, never, KeystoneAuth> =>
  Effect.gen(function*() {
    const base = options.base
    const auth = yield* KeystoneAuth
    const semaphore = yield* Semaphore.make(options.maxConcurrentRequests ?? 8)
    const schedule = Schedule.passthrough(transportRetrySchedule)
    const times = transportMaxRetries
    const duration = options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT

    const attempt = (request: HttpClientRequest.HttpClientRequest) =>
      Effect.gen(function*() {
        const token = yield* auth.token.pipe(
          Effect.mapError((cause) => _authError(request, cause, "keystone token unavailable"))
        )
        const authed = HttpClientRequest.setHeaders(request, {
          "X-Auth-Token": token,
          "X-OpenStack-Nova-API-Version": NOVA_API_MICROVERSION
        })
        return yield* base.execute(authed).pipe(
          Effect.timeoutOrElse({
            duration,
            orElse: () => Effect.fail(_authError(request, undefined, "request timed out"))
          })
        )
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
        Effect.repeat(withReauth(request), {
          schedule,
          times,
          while: (response) => _isRetryable(request.method, response.status)
        })
      )
    )
  })

export const OpenStackHttpLive = (
  options: { readonly maxConcurrentRequests?: number; readonly requestTimeout?: Duration.Input } = {}
): Layer.Layer<HttpClient.HttpClient, never, KeystoneAuth | HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.flatMap(HttpClient.HttpClient, (base) => makeOpenStackHttpClient({ base, ...options }))
  )
