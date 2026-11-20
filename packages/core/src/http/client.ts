import { Duration, Effect, Predicate, Random, Result, Semaphore } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import type * as HttpClientResponse from "effect/http/HttpClientResponse"
import { parseRateLimitReset, parseRetryAfter } from "./retry-after.ts"

type Request = HttpClientRequest.HttpClientRequest

export const IDEMPOTENT_METHODS: ReadonlyArray<string> = ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]

export interface RetryOptions {
  // default 408, 429 and every 5xx
  readonly statuses?: ReadonlyArray<number> | undefined
  // default GET/HEAD/PUT/DELETE/OPTIONS; add POST/PATCH only if the endpoint is safe to repeat
  readonly methods?: ReadonlyArray<string> | undefined
  readonly maxRetries?: number | undefined
  readonly baseDelay?: Duration.Input | undefined
  // caps backoff AND Retry-After / RateLimit-Reset waits
  readonly maxDelay?: Duration.Input | undefined
}

export interface ProviderHttpClientOptions {
  readonly base: HttpClient.HttpClient
  readonly baseUrl?: string | undefined
  readonly authorize?: ((request: Request) => Effect.Effect<Request, HttpClientError.HttpClientError>) | undefined
  // runs once after a 401 (refresh/invalidate token); the request is then re-authorized and replayed once
  readonly onUnauthorized?: Effect.Effect<void, HttpClientError.HttpClientError> | undefined
  // false disables retries entirely
  readonly retry?: RetryOptions | false | undefined
  readonly timeout?: Duration.Input | undefined
  readonly maxConcurrentRequests?: number | undefined
}

const _defaultRetryStatus = (status: number): boolean => status === 408 || status === 429 || status >= 500 && status < 600

const _withBaseUrl = (
  { baseUrl, request }: { readonly request: Request; readonly baseUrl: string | undefined }
): Request => baseUrl === undefined || URL.canParse(request.url) ? request : HttpClientRequest.prependUrl(request, baseUrl)

const _timeoutError = (request: Request): HttpClientError.HttpClientError =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, description: "request timed out" })
  })

const _serverWait = (response: HttpClientResponse.HttpClientResponse): Duration.Duration | undefined =>
  parseRetryAfter(response.headers["retry-after"]) ?? parseRateLimitReset(response.headers["ratelimit-reset"])

export const makeProviderHttpClient = (
  options: ProviderHttpClientOptions
): Effect.Effect<HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const retry = options.retry === false ? undefined : options.retry ?? {}
    const statuses = retry?.statuses

    const retryStatus = (status: number): boolean =>
      statuses === undefined ? _defaultRetryStatus(status) : statuses.includes(status)

    const methods = retry?.methods ?? IDEMPOTENT_METHODS
    const maxRetries = retry === undefined ? 0 : retry.maxRetries ?? 5
    const baseDelayMs = Duration.toMillis(Duration.fromInputUnsafe(retry?.baseDelay ?? "200 millis"))
    const maxDelayMs = Duration.toMillis(Duration.fromInputUnsafe(retry?.maxDelay ?? "60 seconds"))
    const timeout = options.timeout ?? "30 seconds"

    const semaphore = options.maxConcurrentRequests === undefined
      ? undefined
      : yield* Semaphore.make(options.maxConcurrentRequests)

    const attempt = (request: Request) =>
      Effect.gen(function*() {
        const authed = options.authorize === undefined ? request : yield* options.authorize(request)

        return yield* options.base.execute(authed).pipe(
          Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.fail(_timeoutError(request)) })
        )
      })

    const withReauth = (request: Request) =>
      Effect.gen(function*() {
        const response = yield* attempt(request)

        if (response.status !== 401 || options.onUnauthorized === undefined) return response
        yield* options.onUnauthorized

        return yield* attempt(request)
      })

    const delayFor = (
      { response, retry: n }: { readonly retry: number; readonly response: HttpClientResponse.HttpClientResponse | undefined }
    ) =>
      Effect.gen(function*() {
        const server = response === undefined ? undefined : _serverWait(response)

        if (server !== undefined) return Math.min(Duration.toMillis(server), maxDelayMs)
        const jitter = yield* Random.next

        return Math.min(baseDelayMs * 2 ** n * (0.5 + jitter), maxDelayMs)
      })

    const loop = (request: Request, n: number): Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError> =>
      Effect.gen(function*() {
        const canRetry = n < maxRetries && methods.includes(request.method)
        const result = yield* Effect.result(withReauth(request))

        if (Result.isFailure(result)) {
          const reason = result.failure.reason

          if (canRetry && Predicate.isTagged(reason, "TransportError")) {
            yield* Effect.sleep(yield* delayFor({ retry: n, response: undefined }))

            return yield* loop(request, n + 1)
          }

          return yield* Effect.fail(result.failure)
        }

        const response = result.success

        if (canRetry && retryStatus(response.status)) {
          yield* Effect.sleep(yield* delayFor({ retry: n, response }))

          return yield* loop(request, n + 1)
        }

        return response
      })

    const client = HttpClient.make((request) => {
      const run = loop(request, 0)

      return semaphore === undefined ? run : semaphore.withPermit(run)
    })

    // base URL is applied outside make, which parses request.url before its handler runs
    return HttpClient.mapRequest(client, (request) => _withBaseUrl({ request, baseUrl: options.baseUrl }))
  })
