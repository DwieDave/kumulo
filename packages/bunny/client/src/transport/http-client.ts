import { Duration, Effect, Layer, Redacted, Schedule } from "effect"
import type * as HttpClientError from "effect/http/HttpClientError"
import type * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"

export const BUNNY_API_BASE_URL = "https://api.bunny.net"

export const BUNNY_SHIELD_BASE_URL = BUNNY_API_BASE_URL

const _idempotentMethods: ReadonlyArray<string> = ["GET", "HEAD", "DELETE", "OPTIONS"]

const _shouldRetry = ({ method, status }: { readonly method: string; readonly status: number }): boolean =>
  status === 429 || (status >= 500 && status < 600 && _idempotentMethods.includes(method))

export const parseRetryAfter = (value: string | undefined): Duration.Duration | undefined => {
  if (value === undefined) return undefined
  const seconds = Number(value)

  if (Number.isFinite(seconds) && seconds >= 0) return Duration.seconds(Math.min(seconds, 30))
  const at = Date.parse(value)

  if (Number.isNaN(at)) return undefined

  return Duration.millis(Math.min(Math.max(at - Date.now(), 0), 30_000))
}

const _backoff = (retry: number): Duration.Duration => Duration.millis(200 * 2 ** retry * (0.5 + Math.random()))

const _delayFor = (
  { retry, retryAfter }: { readonly retry: number; readonly retryAfter: string | undefined }
): Effect.Effect<Duration.Duration> => Effect.succeed(parseRetryAfter(retryAfter) ?? _backoff(retry))

export const transportRetrySchedule: Schedule.Schedule<Duration.Duration> = Schedule.exponential("200 millis", 2).pipe(
  Schedule.jittered
)

export const transportMaxRetries = 5

export interface BunnyHttpClientOptions {
  readonly base: HttpClient.HttpClient
  readonly apiKey: Redacted.Redacted<string>
  readonly baseUrl?: string
}

const _withBaseUrl = (
  { baseUrl, request }: { readonly request: HttpClientRequest.HttpClientRequest; readonly baseUrl: string }
): HttpClientRequest.HttpClientRequest => URL.canParse(request.url) ? request : HttpClientRequest.prependUrl(request, baseUrl)

export const makeBunnyHttpClient = (options: BunnyHttpClientOptions): HttpClient.HttpClient => {
  const baseUrl = options.baseUrl ?? BUNNY_API_BASE_URL

  const authed = options.base.pipe(
    HttpClient.mapRequest((request) =>
      HttpClientRequest.setHeader(_withBaseUrl({ request, baseUrl }), "AccessKey", Redacted.value(options.apiKey))
    )
  )

  const attempt = (
    { effect, request, retry }: {
      readonly effect: Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>
      readonly request: HttpClientRequest.HttpClientRequest
      readonly retry: number
    }
  ): Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError> =>
    Effect.flatMap(effect, (response) =>
      retry < transportMaxRetries && _shouldRetry({ method: request.method, status: response.status })
        ? Effect.flatMap(_delayFor({ retry, retryAfter: response.headers["retry-after"] }), (delay) =>
          Effect.andThen(Effect.sleep(delay), attempt({ effect, request, retry: retry + 1 })))
        : Effect.succeed(response))

  return HttpClient.transform(authed, (effect, request) => attempt({ effect, request, retry: 0 }))
}

export const BunnyHttpLive = (
  { apiKey, baseUrl }: { readonly apiKey: Redacted.Redacted<string>; readonly baseUrl?: string }
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(HttpClient.HttpClient, Effect.map(HttpClient.HttpClient, (base) => makeBunnyHttpClient({ base, apiKey, baseUrl })))
