import { Effect, Layer, Redacted } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { makeProviderHttpClient } from "@kumulo/core"

export const GODADDY_API_BASE_URL = "https://api.godaddy.com/v3/domains"

const _writeMethods: ReadonlyArray<string> = ["POST", "PUT", "DELETE"]

export interface GodaddyHttpClientOptions {
  readonly base: HttpClient.HttpClient
  readonly token: Redacted.Redacted<string>
  readonly baseUrl?: string
}

const _withIdempotencyKey = (request: HttpClientRequest.HttpClientRequest): HttpClientRequest.HttpClientRequest =>
  _writeMethods.includes(request.method) && request.headers["idempotency-key"] === undefined
    ? HttpClientRequest.setHeader(request, "Idempotency-Key", crypto.randomUUID())
    : request

// Applied before the core client: HttpClient.make rejects a relative URL before core's own baseUrl step runs.
const _prepare = (baseUrl: string) =>
  (request: HttpClientRequest.HttpClientRequest): HttpClientRequest.HttpClientRequest =>
    _withIdempotencyKey(URL.canParse(request.url) ? request : HttpClientRequest.prependUrl(request, baseUrl))

// The key is set before the core client retries, so every retry of one write reuses it.
export const makeGodaddyHttpClient = (options: GodaddyHttpClientOptions): Effect.Effect<HttpClient.HttpClient> =>
  Effect.map(
    makeProviderHttpClient({
      base: options.base,
      authorize: (request) =>
        Effect.succeed(HttpClientRequest.setHeader(request, "Authorization", `Bearer ${Redacted.value(options.token)}`))
    }),
    (client) => HttpClient.mapRequest(client, _prepare(options.baseUrl ?? GODADDY_API_BASE_URL))
  )

export const GodaddyHttpLive = (
  { baseUrl, token }: { readonly token: Redacted.Redacted<string>; readonly baseUrl?: string }
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.flatMap(HttpClient.HttpClient, (base) => makeGodaddyHttpClient({ base, token, baseUrl }))
  )
