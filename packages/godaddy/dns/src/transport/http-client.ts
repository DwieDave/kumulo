import { Duration, Effect, Layer, Option, Redacted, Schema } from "effect"
import type * as HttpClientError from "effect/http/HttpClientError"
import type * as HttpClientResponse from "effect/http/HttpClientResponse"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"

export const GODADDY_API_BASE_URL = "https://api.godaddy.com/v3/domains"

export const transportMaxRetries = 5

export const retryAfterCapSeconds = 30

const _writeMethods: ReadonlyArray<string> = ["POST", "PUT", "DELETE"]

const _retryable5xxMethods: ReadonlyArray<string> = ["GET", "PUT", "DELETE"]

const _shouldRetry = ({ method, status }: { readonly method: string; readonly status: number }): boolean =>
  status === 429 || (status >= 500 && status < 600 && _retryable5xxMethods.includes(method))

export const parseRetryAfter = (value: string | undefined): Duration.Duration | undefined => {
  if (value === undefined) return undefined
  const seconds = Number(value)

  if (Number.isFinite(seconds) && seconds >= 0) return Duration.seconds(Math.min(seconds, retryAfterCapSeconds))
  const at = Date.parse(value)

  if (Number.isNaN(at)) return undefined

  return Duration.millis(Math.min(Math.max(at - Date.now(), 0), retryAfterCapSeconds * 1000))
}

const _backoff = ({ jitter, retry }: { readonly retry: number; readonly jitter: () => number }): Duration.Duration =>
  Duration.millis(200 * 2 ** retry * (0.5 + jitter()))

const _decodeLimitBody = Schema.decodeUnknownOption(Schema.Struct({ retryAfterSec: Schema.Number }))

const _bodyRetryAfter = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<Duration.Duration | undefined> =>
  response.status === 429
    ? response.json.pipe(
      Effect.map((body) =>
        Option.match(_decodeLimitBody(body), {
          onNone: () => undefined,
          onSome: ({ retryAfterSec }) =>
            retryAfterSec >= 0 ? Duration.seconds(Math.min(retryAfterSec, retryAfterCapSeconds)) : undefined
        })
      ),
      Effect.orElseSucceed(() => undefined)
    )
    : Effect.succeed(undefined)

const _delayFor = (
  { jitter, response, retry }: {
    readonly response: HttpClientResponse.HttpClientResponse
    readonly retry: number
    readonly jitter: () => number
  }
): Effect.Effect<Duration.Duration> =>
  Effect.gen(function*() {
    const header = parseRetryAfter(response.headers["retry-after"])

    if (header !== undefined) return header
    const body = yield* _bodyRetryAfter(response)

    return body ?? _backoff({ retry, jitter })
  })

export interface GodaddyHttpClientOptions {
  readonly base: HttpClient.HttpClient
  readonly token: Redacted.Redacted<string>
  readonly baseUrl?: string
  readonly jitter?: () => number
}

const _withBaseUrl = (
  { baseUrl, request }: { readonly request: HttpClientRequest.HttpClientRequest; readonly baseUrl: string }
): HttpClientRequest.HttpClientRequest => URL.canParse(request.url) ? request : HttpClientRequest.prependUrl(request, baseUrl)

const _withIdempotencyKey = (request: HttpClientRequest.HttpClientRequest): HttpClientRequest.HttpClientRequest =>
  _writeMethods.includes(request.method) && request.headers["idempotency-key"] === undefined
    ? HttpClientRequest.setHeader(request, "Idempotency-Key", crypto.randomUUID())
    : request

export const makeGodaddyHttpClient = (options: GodaddyHttpClientOptions): HttpClient.HttpClient => {
  const baseUrl = options.baseUrl ?? GODADDY_API_BASE_URL
  const jitter = options.jitter ?? Math.random

  const authed = options.base.pipe(
    HttpClient.mapRequest((request) =>
      HttpClientRequest.setHeader(
        _withBaseUrl({ request, baseUrl }),
        "Authorization",
        `Bearer ${Redacted.value(options.token)}`
      )
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
        ? Effect.flatMap(_delayFor({ response, retry, jitter }), (delay) =>
          Effect.andThen(
            Effect.andThen(Effect.ignore(response.text), Effect.sleep(delay)),
            attempt({ effect, request, retry: retry + 1 })
          ))
        : Effect.succeed(response))

  return HttpClient.transform(authed, (effect, request) => attempt({ effect, request, retry: 0 })).pipe(
    HttpClient.mapRequest(_withIdempotencyKey)
  )
}

export const GodaddyHttpLive = (
  { baseUrl, token }: { readonly token: Redacted.Redacted<string>; readonly baseUrl?: string }
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(HttpClient.HttpClient, Effect.map(HttpClient.HttpClient, (base) => makeGodaddyHttpClient({ base, token, baseUrl })))
