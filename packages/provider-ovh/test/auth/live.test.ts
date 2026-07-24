import { Effect, Layer, Redacted } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { OvhAuth } from "../../src/auth/port.ts"
import { OvhAuthLive } from "../../src/auth/live.ts"

const creds = { clientId: "id", clientSecret: Redacted.make("secret") }

/** Fixture HttpClient: counts calls, replies with a fresh token each time (zero network). */
const _fakeTransport = (expiresInSeconds: number) => {
  let calls = 0
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      calls += 1
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify({ access_token: `token-${calls}`, expires_in: expiresInSeconds }), { status: 200 })
        )
      )
    })
  )
  return { layer, callCount: () => calls }
}

it.effect("caches the token across calls within its expiry", () => {
  const transport = _fakeTransport(3600)
  return Effect.gen(function* () {
    const auth = yield* OvhAuth
    const first = yield* auth.token
    const second = yield* auth.token
    assert.strictEqual(first, "token-1")
    assert.strictEqual(second, "token-1")
    assert.strictEqual(transport.callCount(), 1)
  }).pipe(Effect.provide(OvhAuthLive(creds).pipe(Layer.provide(transport.layer))))
})

it.effect("refetches once the cached token is within the expiry skew window", () => {
  const transport = _fakeTransport(30) // < 60s skew — every call should refetch
  return Effect.gen(function* () {
    const auth = yield* OvhAuth
    const first = yield* auth.token
    const second = yield* auth.token
    assert.strictEqual(first, "token-1")
    assert.strictEqual(second, "token-2")
    assert.strictEqual(transport.callCount(), 2)
  }).pipe(Effect.provide(OvhAuthLive(creds).pipe(Layer.provide(transport.layer))))
})

// kumulo: it.live, not it.effect — this path exercises the real exp-backoff+jitter
// retry Schedule, which needs real time to advance (it.effect's virtual TestClock
// never advances on its own, so Effect.sleep here would hang the test).
it.live("wraps a persistent token-endpoint failure as AuthenticationFailed", () => {
  const forbidden = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response("forbidden", { status: 403 }))))
  )
  return Effect.gen(function* () {
    const auth = yield* OvhAuth
    const result = yield* Effect.flip(auth.token)
    assert.strictEqual(result._tag, "AuthenticationFailed")
  }).pipe(Effect.provide(OvhAuthLive(creds).pipe(Layer.provide(forbidden))))
})
