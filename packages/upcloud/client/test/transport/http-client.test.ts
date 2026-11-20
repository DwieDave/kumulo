import { Effect, Fiber, Redacted } from "effect"
import { assert, it } from "@effect/vitest"
import { TestClock } from "effect/testing"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { makeUpcloudHttpClient } from "../../src/transport/http-client.ts"

const _rawHttpClient = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request))))

it.effect("sends the bearer token and prepends the UpCloud API base URL", () =>
  Effect.gen(function*() {
    let captured: { readonly url: string; readonly auth: string | undefined } | undefined

    const base = _rawHttpClient((request) => {
      captured = { url: request.url, auth: request.headers.authorization }

      return new Response(null, { status: 200 })
    })

    const client = yield* makeUpcloudHttpClient({ base, token: Redacted.make("secret-token"), baseUrl: "https://fixture.invalid" })
    yield* client.execute(HttpClientRequest.get("/1.3/kubernetes"))
    assert.strictEqual(captured?.url, "https://fixture.invalid/1.3/kubernetes")
    assert.strictEqual(captured?.auth, "Bearer secret-token")
  }))

// R6: the token is a `Redacted<string>` — rendering it (`String`, template
// literal, JSON.stringify) must never expose the raw secret, including when
// that render happens as part of an error message built around the client.
it.effect("never leaks the token when the client (or an error carrying it) is rendered", () => Effect.gen(function*() {
  const token = Redacted.make("super-secret-token")
  const base = _rawHttpClient(() => new Response(null, { status: 500 }))
  const client = yield* makeUpcloudHttpClient({ base, token, baseUrl: "https://fixture.invalid" })
  const rendered = `${String(token)} ${JSON.stringify({ client, token })}`
  assert.strictEqual(rendered.includes("super-secret-token"), false)
}))

it.effect("retries on 429 and eventually succeeds", () =>
  Effect.gen(function*() {
    let calls = 0

    const base = _rawHttpClient(() => {
      calls++

      return new Response(null, { status: calls < 3 ? 429 : 200 })
    })

    const client = yield* makeUpcloudHttpClient({ base, token: Redacted.make("secret-token"), baseUrl: "https://fixture.invalid" })
    const fiber = yield* Effect.forkChild(client.execute(HttpClientRequest.get("/1.3/kubernetes")))
    yield* TestClock.adjust("10 seconds")
    const response = yield* Fiber.join(fiber)
    assert.strictEqual(response.status, 200)
    assert.strictEqual(calls, 3)
  }))

it.effect("gives up after the max retry bound on a persistent 5xx", () =>
  Effect.gen(function*() {
    let calls = 0

    const base = _rawHttpClient(() => {
      calls++

      return new Response(null, { status: 503 })
    })

    const client = yield* makeUpcloudHttpClient({ base, token: Redacted.make("secret-token"), baseUrl: "https://fixture.invalid" })
    const fiber = yield* Effect.forkChild(client.execute(HttpClientRequest.get("/1.3/kubernetes")))
    yield* TestClock.adjust("10 minutes")
    const response = yield* Fiber.join(fiber)
    assert.strictEqual(response.status, 503)
    assert.strictEqual(calls, 6) // 1 initial + 5 retries
  }))

const _client = (base: HttpClient.HttpClient, requestTimeout?: "1 second") =>
  makeUpcloudHttpClient({ base, token: Redacted.make("t"), baseUrl: "https://fixture.invalid", requestTimeout })

it.effect("does not retry a POST on 5xx", () =>
  Effect.gen(function*() {
    let calls = 0

    const base = _rawHttpClient(() => {
      calls++

      return new Response(null, { status: 503 })
    })

    const response = yield* (yield* _client(base)).execute(HttpClientRequest.post("/1.3/storage"))
    assert.strictEqual(response.status, 503)
    assert.strictEqual(calls, 1)
  }))

it.effect("does not retry a POST on 429", () =>
  Effect.gen(function*() {
    let calls = 0

    const base = _rawHttpClient(() => {
      calls++

      return new Response(null, { status: 429 })
    })

    const response = yield* (yield* _client(base)).execute(HttpClientRequest.post("/1.3/storage"))
    assert.strictEqual(response.status, 429)
    assert.strictEqual(calls, 1)
  }))

it.effect("does not retry a PATCH on 5xx", () =>
  Effect.gen(function*() {
    let calls = 0

    const base = _rawHttpClient(() => {
      calls++

      return new Response(null, { status: 503 })
    })

    const response = yield* (yield* _client(base)).execute(HttpClientRequest.patch("/1.3/storage"))
    assert.strictEqual(response.status, 503)
    assert.strictEqual(calls, 1)
  }))

for (const method of ["GET", "PUT", "DELETE"] as const) {
  it.effect(`still retries ${method} on 5xx`, () =>
    Effect.gen(function*() {
      let calls = 0

      const base = _rawHttpClient(() => {
        calls++

        return new Response(null, { status: 503 })
      })

      const fiber = yield* Effect.forkChild((yield* _client(base)).execute(HttpClientRequest.make(method)("/1.3/x")))
      yield* TestClock.adjust("1 minute")
      const response = yield* Fiber.join(fiber)
      assert.strictEqual(response.status, 503)
      assert.strictEqual(calls, 6)
    }))
}


it.effect("waits Retry-After seconds on 429", () =>
  Effect.gen(function*() {
    let calls = 0

    const base = _rawHttpClient(() => {
      calls++

      return calls === 1 ? new Response(null, { status: 429, headers: { "retry-after": "2" } }) : new Response(null, { status: 200 })
    })

    const fiber = yield* Effect.forkChild((yield* _client(base)).execute(HttpClientRequest.get("/1.3/x")))
    yield* TestClock.adjust("1 second")
    assert.strictEqual(calls, 1)
    yield* TestClock.adjust("1 second")
    yield* Fiber.join(fiber)
    assert.strictEqual(calls, 2)
  }))

it.effect("fails with a timeout when the server never answers", () =>
  Effect.gen(function*() {
    const base = HttpClient.make(() => Effect.never)
    const fiber = yield* Effect.forkChild(Effect.flip((yield* _client(base, "1 second")).execute(HttpClientRequest.get("/1.3/x"))))
    yield* TestClock.adjust("10 minutes")
    const error = yield* Fiber.join(fiber)
    assert.isTrue(HttpClientError.isHttpClientError(error))
    assert.strictEqual(error.reason._tag, "TransportError")
  }))
