import { Duration, Effect, Layer, Random, Schedule } from "effect"
import type { Redacted } from "effect"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"

export const UPCLOUD_API_BASE_URL = "https://api.upcloud.com"

// UpCloud PATCHes are full-value updates, so retrying them is safe; a retried POST could double-create
const _idempotent: ReadonlySet<string> = new Set(["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"])

const _isRetryable = (method: string, status: number): boolean =>
  status === 429 || (_idempotent.has(method) && status >= 500 && status < 600)

export const DEFAULT_REQUEST_TIMEOUT: Duration.Input = "30 seconds"

export const retryAfterCapSeconds = 60

const _retryAfterSeconds = (value: string | undefined): number | undefined =>
  value !== undefined && /^\d+$/.test(value.trim()) ? Math.min(Number(value.trim()), retryAfterCapSeconds) : undefined

export const transportRetrySchedule: Schedule.Schedule<Duration.Duration> = Schedule.exponential("200 millis", 2).pipe(
  Schedule.jittered
)

export const transportMaxRetries = 5

export interface UpcloudHttpClientOptions {
  readonly base: HttpClient.HttpClient
  readonly token: Redacted.Redacted<string>
  readonly baseUrl?: string
  readonly requestTimeout?: Duration.Input
}

export const makeUpcloudHttpClient = (options: UpcloudHttpClientOptions): HttpClient.HttpClient => {
  const baseUrl = options.baseUrl ?? UPCLOUD_API_BASE_URL

  const duration = options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT

  const attempt = (request: HttpClientRequest.HttpClientRequest) =>
    options.base.execute(request).pipe(
      Effect.timeoutOrElse({
        duration,
        orElse: () =>
          Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request, description: "UpCloud request timed out" })
            })
          )
      })
    )

  // the exponential schedule paces 5xx retries; a numeric Retry-After on a 429 replaces its delay
  const run = (request: HttpClientRequest.HttpClientRequest) =>
    Effect.gen(function*() {
      let response = yield* attempt(request)

      for (let retries = 0; retries < transportMaxRetries && _isRetryable(request.method, response.status); retries++) {
        const retryAfter = response.status === 429 ? _retryAfterSeconds(response.headers["retry-after"]) : undefined
        const jitter = yield* Random.nextBetween(0.8, 1.2)
        yield* Effect.sleep(retryAfter !== undefined ? Duration.seconds(retryAfter) : Duration.millis(200 * 2 ** retries * jitter))
        response = yield* attempt(request)
      }

      return response
    })

  return HttpClient.make((request) => run(request)).pipe(
    HttpClient.mapRequest((request) => request.pipe(HttpClientRequest.bearerToken(options.token), HttpClientRequest.prependUrl(baseUrl)))
  )
}

export const UpcloudHttpLive = (
  { token, baseUrl }: { readonly token: Redacted.Redacted<string>; readonly baseUrl?: string }
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(HttpClient.HttpClient, Effect.map(HttpClient.HttpClient, (base) => makeUpcloudHttpClient({ base, token, baseUrl })))
