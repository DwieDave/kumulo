// duplicated from openstack's transportRetrySchedule, not shared: dependency-cruiser forbids importing a sibling's src/ internals
import { Effect, Layer, Schedule } from "effect"
import type { Duration, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"

export const HETZNER_API_BASE_URL = "https://api.hetzner.cloud/v1"

const _isRetryableStatus = (status: number): boolean => status === 429 || (status >= 500 && status < 600)

export const transportRetrySchedule: Schedule.Schedule<Duration.Duration> = Schedule.exponential("200 millis", 2).pipe(
  Schedule.jittered
)
export const transportMaxRetries = 5

export interface HetznerHttpClientOptions {
  readonly base: HttpClient.HttpClient
  readonly token: Redacted.Redacted<string>
  readonly baseUrl?: string
}

export const makeHetznerHttpClient = (options: HetznerHttpClientOptions): HttpClient.HttpClient => {
  const baseUrl = options.baseUrl ?? HETZNER_API_BASE_URL
  const authed = options.base.pipe(
    HttpClient.mapRequest((request) => request.pipe(HttpClientRequest.bearerToken(options.token), HttpClientRequest.prependUrl(baseUrl)))
  )
  const schedule = Schedule.passthrough(transportRetrySchedule)
  return HttpClient.transformResponse(
    authed,
    (effect) => Effect.repeat(effect, { schedule, times: transportMaxRetries, while: (response) => _isRetryableStatus(response.status) })
  )
}

export const HetznerHttpLive = (
  { token, baseUrl }: { readonly token: Redacted.Redacted<string>; readonly baseUrl?: string }
): Layer.Layer<HttpClient.HttpClient, never, HttpClient.HttpClient> =>
  Layer.effect(HttpClient.HttpClient, Effect.map(HttpClient.HttpClient, (base) => makeHetznerHttpClient({ base, token, baseUrl })))
