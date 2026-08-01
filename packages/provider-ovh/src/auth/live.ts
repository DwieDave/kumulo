import { Clock, Effect, Layer, Redacted, Ref, Schedule } from "effect"
import * as Schema from "effect/Schema"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { AuthenticationFailed } from "@kumulo/core"
import { OvhAuth } from "./port.ts"

export const OVH_TOKEN_ENDPOINT = "https://www.ovh.com/auth/oauth2/token"

export interface OvhCredentials {
  readonly clientId: string
  readonly clientSecret: Redacted.Redacted<string>
  readonly scope?: string
  readonly tokenEndpoint?: string
}

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Number
})

const _skewMillis = 60_000

const _retrySchedule = Schedule.exponential("200 millis").pipe(Schedule.jittered, Schedule.upTo({ times: 3 }))

const _requestToken = (creds: OvhCredentials, httpClient: HttpClient.HttpClient) =>
  Effect.gen(function* () {
    const request = HttpClientRequest.post(creds.tokenEndpoint ?? OVH_TOKEN_ENDPOINT).pipe(
      HttpClientRequest.bodyUrlParams({
        grant_type: "client_credentials",
        client_id: creds.clientId,
        client_secret: Redacted.value(creds.clientSecret),
        // OVH issues a valid-but-unauthorized token when no scope is requested (every call 401s)
        scope: creds.scope ?? "all"
      })
    )
    const response = yield* httpClient.execute(request).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk))
    return yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response)
  }).pipe(
    Effect.retry(_retrySchedule),
    Effect.mapError((cause) => new AuthenticationFailed({ hint: `OVH OAuth2 token request failed: ${String(cause)}` }))
  )

interface CachedToken {
  readonly accessToken: string
  readonly expiresAt: number
}

const _getToken = (creds: OvhCredentials, httpClient: HttpClient.HttpClient, cache: Ref.Ref<CachedToken | undefined>) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const cached = yield* Ref.get(cache)
    if (cached && cached.expiresAt - _skewMillis > now) return cached.accessToken

    const fresh = yield* _requestToken(creds, httpClient)
    yield* Ref.set(cache, { accessToken: fresh.access_token, expiresAt: now + fresh.expires_in * 1000 })
    return fresh.access_token
  })

export const OvhAuthLive = (
  creds: OvhCredentials
): Layer.Layer<OvhAuth, never, HttpClient.HttpClient> =>
  Layer.effect(
    OvhAuth,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient
      const cache = yield* Ref.make<CachedToken | undefined>(undefined)
      return { token: _getToken(creds, httpClient, cache) }
    })
  )
