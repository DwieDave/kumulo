import { Effect, Layer, Redacted } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { hcloudHttpClientLayer } from "../../src/auth/client.ts"

const token = Redacted.make("hcloud-token")
const request = HttpClientRequest.get("https://api.hetzner.cloud/v1/servers")

const _fakeBase = (respond: (callNumber: number) => { readonly status: number; readonly headers?: Record<string, string> }) => {
  let calls = 0
  let seenAuth: string | undefined
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((req) => {
      calls += 1
      seenAuth = req.headers["authorization"]
      const { headers, status } = respond(calls)
      return Effect.succeed(HttpClientResponse.fromWeb(req, new Response("{}", { status, headers })))
    })
  )
  return { layer, callCount: () => calls, seenAuth: () => seenAuth }
}

it.effect("injects a Bearer authorization header and passes a 200 through untouched", () => {
  const fake = _fakeBase(() => ({ status: 200 }))
  return Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.execute(request)
    assert.strictEqual(response.status, 200)
    assert.strictEqual(fake.seenAuth(), "Bearer hcloud-token")
    assert.strictEqual(fake.callCount(), 1)
  }).pipe(Effect.provide(hcloudHttpClientLayer(token).pipe(Layer.provide(fake.layer))))
})

// kumulo: it.live, not it.effect — exercises the real `Effect.sleep` between
// retries (mirrors provider-ovh's `auth/live.test.ts` "persistent failure"
// case, same it.effect-TestClock-never-advances reasoning). `retry-after: 0`
// keeps this fast and deterministic — no jitter/backoff randomness involved.
it.live("retries a 429 honoring Retry-After, then succeeds", () => {
  const fake = _fakeBase((callNumber) => callNumber === 1 ? { status: 429, headers: { "retry-after": "0" } } : { status: 200 })
  return Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.execute(request)
    assert.strictEqual(response.status, 200)
    assert.strictEqual(fake.callCount(), 2)
  }).pipe(Effect.provide(hcloudHttpClientLayer(token).pipe(Layer.provide(fake.layer))))
})

it.live("gives up after the bounded retry cap, still surfacing the last response", () => {
  const fake = _fakeBase(() => ({ status: 429, headers: { "retry-after": "0" } }))
  return Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.execute(request)
    assert.strictEqual(response.status, 429)
    // 1 initial attempt + 5 bounded retries.
    assert.strictEqual(fake.callCount(), 6)
  }).pipe(Effect.provide(hcloudHttpClientLayer(token).pipe(Layer.provide(fake.layer))))
})
