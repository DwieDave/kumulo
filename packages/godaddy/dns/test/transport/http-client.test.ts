import { Effect, Random, Redacted } from "effect"
import { assert, it } from "@effect/vitest"
import { TestClock } from "effect/testing"
import * as Fiber from "effect/Fiber"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { GodaddyHttpLive, makeGodaddyHttpClient } from "../../src/transport/http-client.ts"

interface Seen {
  readonly url: string
  readonly auth: string | undefined
  readonly key: string | undefined
}

const _scripted = (responses: ReadonlyArray<() => Response>) => {
  const seen: Array<Seen> = []

  const base = HttpClient.make((request) =>
    Effect.sync(() => {
      const index = Math.min(seen.length, responses.length - 1)
      seen.push({ url: request.url, auth: request.headers.authorization, key: request.headers["idempotency-key"] })
      const make = responses[index]

      return HttpClientResponse.fromWeb(request, make ? make() : new Response(null, { status: 200 }))
    })
  )

  return { seen, base }
}

const _maxRetries = 5

const _exec = (base: HttpClient.HttpClient, request: HttpClientRequest.HttpClientRequest) =>
  Effect.flatMap(
    makeGodaddyHttpClient({ base, token: Redacted.make("pat"), baseUrl: "https://fixture.invalid/v3/domains" }),
    (client) => client.execute(request)
  )

const _status = (status: number, init?: ResponseInit & { readonly body?: string }) => () =>
  new Response(init?.body ?? null, { status, headers: init?.headers })

const _run = <A, E>(effect: Effect.Effect<A, E>, advance: number) =>
  Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(effect)
    yield* Effect.yieldNow
    yield* TestClock.adjust(advance)

    return yield* Fiber.join(fiber)
  })

const _get = HttpClientRequest.get("/x")

it.effect("sends Bearer auth and prefixes the base URL onto relative URLs only", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(200)])
    yield* _exec(base, HttpClientRequest.get("/zones/a.com/records"))
    yield* _exec(base, HttpClientRequest.get("https://other.invalid/x"))
    assert.strictEqual(seen[0]?.url, "https://fixture.invalid/v3/domains/zones/a.com/records")
    assert.strictEqual(seen[0]?.auth, "Bearer pat")
    assert.strictEqual(seen[1]?.url, "https://other.invalid/x")
    assert.strictEqual(seen[1]?.auth, "Bearer pat")
  }))

it.effect("defaults to the GoDaddy v3 domains base", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(200)])
    const client = yield* makeGodaddyHttpClient({ base, token: Redacted.make("t") })
    yield* client.execute(_get)
    assert.strictEqual(seen[0]?.url, "https://api.godaddy.com/v3/domains/x")
  }))

it.effect("GodaddyHttpLive wraps the provided client", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(200)])

    const program = Effect.flatMap(HttpClient.HttpClient, (client) => client.execute(_get)).pipe(
      Effect.provide(GodaddyHttpLive({ token: Redacted.make("t") })),
      Effect.provideService(HttpClient.HttpClient, base)
    )

    yield* program
    assert.strictEqual(seen[0]?.auth, "Bearer t")
  }))

it.effect("retries 429 honouring Retry-After", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(429, { headers: { "Retry-After": "3" } }), _status(200)])
    const response = yield* _run(_exec(base, _get), 3000)
    assert.strictEqual(response.status, 200)
    assert.strictEqual(seen.length, 2)
  }))

it.effect("does not retry 429 before Retry-After elapses", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(429, { headers: { "Retry-After": "10" } }), _status(200)])
    const fiber = yield* Effect.forkChild(_exec(base, _get))
    yield* Effect.yieldNow
    yield* TestClock.adjust(9000)
    assert.strictEqual(seen.length, 1)
    yield* TestClock.adjust(1000)
    const response = yield* Fiber.join(fiber)
    assert.strictEqual(response.status, 200)
  }))

it.effect("never retries a POST, not even on 429", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(429, { headers: { "Retry-After": "1" } }), _status(200)])
    const response = yield* _exec(base, HttpClientRequest.post("/x"))
    assert.strictEqual(response.status, 429)
    assert.strictEqual(seen.length, 1)
  }))

it.effect("does not retry 5xx on POST", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(503), _status(200)])
    const response = yield* _exec(base, HttpClientRequest.post("/x"))
    assert.strictEqual(response.status, 503)
    assert.strictEqual(seen.length, 1)
  }))

it.effect("retries 5xx on GET", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(500), _status(200)])
    const response = yield* _run(_exec(base, _get), 5000)
    assert.strictEqual(response.status, 200)
    assert.strictEqual(seen.length, 2)
  }))

it.effect("retries 5xx on PUT and DELETE", () =>
  Effect.gen(function*() {
    const put = _scripted([_status(502), _status(200)])
    const del = _scripted([_status(502), _status(200)])
    yield* _run(_exec(put.base, HttpClientRequest.put("/x")), 5000)
    yield* _run(_exec(del.base, HttpClientRequest.delete("/x")), 5000)
    assert.strictEqual(put.seen.length, 2)
    assert.strictEqual(del.seen.length, 2)
  }))

it.effect("reuses one Idempotency-Key across retries and sets none on GET", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(429, { headers: { "Retry-After": "1" } }), _status(429, { headers: { "Retry-After": "1" } }), _status(200)])
    yield* _run(_exec(base, HttpClientRequest.put("/x")), 2000)
    assert.strictEqual(seen.length, 3)
    const keys = new Set(seen.map((entry) => entry.key))
    assert.strictEqual(keys.size, 1)
    assert.match(seen[0]?.key ?? "", /^[0-9a-f-]{36}$/)

    const get = _scripted([_status(200)])
    yield* _exec(get.base, _get)
    assert.strictEqual(get.seen[0]?.key, undefined)
  }))

it.effect("keeps a caller supplied Idempotency-Key and generates a fresh one per write", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(200)])
    const client = yield* makeGodaddyHttpClient({ base, token: Redacted.make("pat"), baseUrl: "https://fixture.invalid" })
    yield* client.execute(HttpClientRequest.post("/x").pipe(HttpClientRequest.setHeader("Idempotency-Key", "mine")))
    yield* client.execute(HttpClientRequest.post("/x"))
    yield* client.execute(HttpClientRequest.post("/x"))
    assert.strictEqual(seen[0]?.key, "mine")
    assert.notStrictEqual(seen[1]?.key, seen[2]?.key)
  }))

it.effect("stops retrying at the cap and returns the last response", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(429, { headers: { "Retry-After": "1" } })])
    const response = yield* _run(_exec(base, _get), 60_000)
    assert.strictEqual(response.status, 429)
    assert.strictEqual(seen.length, _maxRetries + 1)
  }))

it.effect("caps an absurd Retry-After wait", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(429, { headers: { "Retry-After": "100000" } }), _status(200)])
    const response = yield* _run(_exec(base, _get), 60_000)
    assert.strictEqual(response.status, 200)
    assert.strictEqual(seen.length, 2)
  }))

it.effect("waits exactly the injected-jitter backoff before a retry", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(503), _status(200)])
    const random = { nextIntUnsafe: () => 0, nextDoubleUnsafe: () => 0.5 }
    const run = Effect.provideService(_exec(base, _get), Random.Random, random)

    const fiber = yield* Effect.forkChild(run)

    yield* Effect.yieldNow
    yield* TestClock.adjust(199)

    assert.strictEqual(seen.length, 1)

    yield* TestClock.adjust(1)

    const response = yield* Fiber.join(fiber)

    assert.strictEqual(response.status, 200)
    assert.strictEqual(seen.length, 2)
  }))
