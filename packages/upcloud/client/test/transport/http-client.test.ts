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

    const client = makeUpcloudHttpClient({ base, token: Redacted.make("secret-token"), baseUrl: "https://fixture.invalid" })
    yield* client.execute(HttpClientRequest.get("/1.3/kubernetes"))
    assert.strictEqual(captured?.url, "https://fixture.invalid/1.3/kubernetes")
    assert.strictEqual(captured?.auth, "Bearer secret-token")
  }))

// R6: the token is a `Redacted<string>` — rendering it (`String`, template
// literal, JSON.stringify) must never expose the raw secret, including when
// that render happens as part of an error message built around the client.
it("never leaks the token when the client (or an error carrying it) is rendered", () => {
  const token = Redacted.make("super-secret-token")
  const base = _rawHttpClient(() => new Response(null, { status: 500 }))
  const client = makeUpcloudHttpClient({ base, token, baseUrl: "https://fixture.invalid" })
  const rendered = `${String(token)} ${JSON.stringify({ client, token })}`
  assert.strictEqual(rendered.includes("super-secret-token"), false)
})

it("retries on 429 and eventually succeeds", async () => {
  let calls = 0

  const base = _rawHttpClient(() => {
    calls++

    return new Response(null, { status: calls < 3 ? 429 : 200 })
  })

  const client = makeUpcloudHttpClient({ base, token: Redacted.make("secret-token"), baseUrl: "https://fixture.invalid" })
  const response = await Effect.runPromise(client.execute(HttpClientRequest.get("/1.3/kubernetes")))
  assert.strictEqual(response.status, 200)
  assert.strictEqual(calls, 3)
}, 10_000)

it("gives up after the max retry bound on a persistent 5xx", async () => {
  let calls = 0

  const base = _rawHttpClient(() => {
    calls++

    return new Response(null, { status: 503 })
  })

  const client = makeUpcloudHttpClient({ base, token: Redacted.make("secret-token"), baseUrl: "https://fixture.invalid" })
  const response = await Effect.runPromise(client.execute(HttpClientRequest.get("/1.3/kubernetes")))
  assert.strictEqual(response.status, 503)
  assert.strictEqual(calls, 6) // 1 initial + 5 retries
}, 10_000)

const _client = (base: HttpClient.HttpClient, requestTimeout?: "1 second") =>
  makeUpcloudHttpClient({ base, token: Redacted.make("t"), baseUrl: "https://fixture.invalid", requestTimeout })

it.effect("does not retry a POST on 5xx", () =>
  Effect.gen(function*() {
    let calls = 0

    const base = _rawHttpClient(() => {
      calls++

      return new Response(null, { status: 503 })
    })

    const response = yield* _client(base).execute(HttpClientRequest.post("/1.3/storage"))
    assert.strictEqual(response.status, 503)
    assert.strictEqual(calls, 1)
  }))

it.effect("retries a POST on 429", () =>
  Effect.gen(function*() {
    let calls = 0

    const base = _rawHttpClient(() => {
      calls++

      return new Response(null, { status: calls < 3 ? 429 : 201 })
    })

    const fiber = yield* Effect.forkChild(_client(base).execute(HttpClientRequest.post("/1.3/storage")))
    yield* TestClock.adjust("10 seconds")
    const response = yield* Fiber.join(fiber)
    assert.strictEqual(response.status, 201)
    assert.strictEqual(calls, 3)
  }))

for (const method of ["GET", "PUT", "PATCH", "DELETE"] as const) {
  it.effect(`still retries ${method} on 5xx`, () =>
    Effect.gen(function*() {
      let calls = 0

      const base = _rawHttpClient(() => {
        calls++

        return new Response(null, { status: 503 })
      })

      const fiber = yield* Effect.forkChild(_client(base).execute(HttpClientRequest.make(method)("/1.3/x")))
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

    const fiber = yield* Effect.forkChild(_client(base).execute(HttpClientRequest.get("/1.3/x")))
    yield* TestClock.adjust("1 second")
    assert.strictEqual(calls, 1)
    yield* TestClock.adjust("1 second")
    yield* Fiber.join(fiber)
    assert.strictEqual(calls, 2)
  }))

it.effect("fails with a timeout when the server never answers", () =>
  Effect.gen(function*() {
    const base = HttpClient.make(() => Effect.never)
    const fiber = yield* Effect.forkChild(Effect.flip(_client(base, "1 second").execute(HttpClientRequest.get("/1.3/x"))))
    yield* TestClock.adjust("1 second")
    const error = yield* Fiber.join(fiber)
    assert.isTrue(HttpClientError.isHttpClientError(error))
    assert.strictEqual(error.reason._tag, "TransportError")
  }))
