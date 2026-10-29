import { Effect, Redacted } from "effect"
import { assert, it } from "@effect/vitest"
import { TestClock } from "effect/testing"
import * as Fiber from "effect/Fiber"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { GodaddyHttpLive, makeGodaddyHttpClient, transportMaxRetries } from "../../src/transport/http-client.ts"

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

const _client = (base: HttpClient.HttpClient) =>
  makeGodaddyHttpClient({ base, token: Redacted.make("pat"), baseUrl: "https://fixture.invalid/v3/domains" })

const _status = (status: number, init?: ResponseInit & { readonly body?: string }) => () =>
  new Response(init?.body ?? null, { status, headers: init?.headers })

const _run = <A, E>(effect: Effect.Effect<A, E>, advance: number) =>
  Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(effect)
    yield* Effect.yieldNow
    yield* TestClock.adjust(advance)

    return yield* Fiber.join(fiber)
  })

it.effect("sends Bearer auth and prefixes the base URL onto relative URLs only", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(200)])
    const client = _client(base)
    yield* client.execute(HttpClientRequest.get("/zones/a.com/records"))
    yield* client.execute(HttpClientRequest.get("https://other.invalid/x"))
    assert.strictEqual(seen[0]?.url, "https://fixture.invalid/v3/domains/zones/a.com/records")
    assert.strictEqual(seen[0]?.auth, "Bearer pat")
    assert.strictEqual(seen[1]?.url, "https://other.invalid/x")
    assert.strictEqual(seen[1]?.auth, "Bearer pat")
  }))

it.effect("defaults to the GoDaddy v3 domains base", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(200)])
    yield* makeGodaddyHttpClient({ base, token: Redacted.make("t") }).execute(HttpClientRequest.get("/x"))
    assert.strictEqual(seen[0]?.url, "https://api.godaddy.com/v3/domains/x")
  }))

it.effect("GodaddyHttpLive wraps the provided client", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(200)])

    const program = Effect.flatMap(HttpClient.HttpClient, (client) => client.execute(HttpClientRequest.get("/x"))).pipe(
      Effect.provide(GodaddyHttpLive({ token: Redacted.make("t") })),
      Effect.provideService(HttpClient.HttpClient, base)
    )

    yield* program
    assert.strictEqual(seen[0]?.auth, "Bearer t")
  }))

it.effect("retries 429 honouring Retry-After", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(429, { headers: { "Retry-After": "3" } }), _status(200)])
    const response = yield* _run(_client(base).execute(HttpClientRequest.get("/x")), 3000)
    assert.strictEqual(response.status, 200)
    assert.strictEqual(seen.length, 2)
  }))

it.effect("does not retry 429 before Retry-After elapses", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(429, { headers: { "Retry-After": "10" } }), _status(200)])
    const fiber = yield* Effect.forkChild(_client(base).execute(HttpClientRequest.get("/x")))
    yield* Effect.yieldNow
    yield* TestClock.adjust(9000)
    assert.strictEqual(seen.length, 1)
    yield* TestClock.adjust(1000)
    const response = yield* Fiber.join(fiber)
    assert.strictEqual(response.status, 200)
  }))

it.effect("retries 429 using retryAfterSec from the body, capped", () =>
  Effect.gen(function*() {
    const body = JSON.stringify({ code: "TOO_MANY_REQUESTS", retryAfterSec: 5000 })
    const { base, seen } = _scripted([_status(429, { body }), _status(200)])
    const response = yield* _run(_client(base).execute(HttpClientRequest.get("/x")), 30_000)
    assert.strictEqual(response.status, 200)
    assert.strictEqual(seen.length, 2)
  }))

it.effect("retries 429 on POST", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(429, { headers: { "Retry-After": "1" } }), _status(200)])
    const response = yield* _run(_client(base).execute(HttpClientRequest.post("/x")), 1000)
    assert.strictEqual(response.status, 200)
    assert.strictEqual(seen.length, 2)
  }))

it.effect("does not retry 5xx on POST", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(503), _status(200)])
    const response = yield* _client(base).execute(HttpClientRequest.post("/x"))
    assert.strictEqual(response.status, 503)
    assert.strictEqual(seen.length, 1)
  }))

it.effect("retries 5xx on GET", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(500), _status(200)])
    const response = yield* _run(_client(base).execute(HttpClientRequest.get("/x")), 5000)
    assert.strictEqual(response.status, 200)
    assert.strictEqual(seen.length, 2)
  }))

it.effect("retries 5xx on PUT and DELETE", () =>
  Effect.gen(function*() {
    const put = _scripted([_status(502), _status(200)])
    const del = _scripted([_status(502), _status(200)])
    yield* _run(_client(put.base).execute(HttpClientRequest.put("/x")), 5000)
    yield* _run(_client(del.base).execute(HttpClientRequest.delete("/x")), 5000)
    assert.strictEqual(put.seen.length, 2)
    assert.strictEqual(del.seen.length, 2)
  }))

it.effect("reuses one Idempotency-Key across retries and sets none on GET", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(429, { headers: { "Retry-After": "1" } }), _status(429, { headers: { "Retry-After": "1" } }), _status(200)])
    yield* _run(_client(base).execute(HttpClientRequest.put("/x")), 2000)
    assert.strictEqual(seen.length, 3)
    const keys = new Set(seen.map((entry) => entry.key))
    assert.strictEqual(keys.size, 1)
    assert.match(seen[0]?.key ?? "", /^[0-9a-f-]{36}$/)

    const get = _scripted([_status(200)])
    yield* _client(get.base).execute(HttpClientRequest.get("/x"))
    assert.strictEqual(get.seen[0]?.key, undefined)
  }))

it.effect("keeps a caller supplied Idempotency-Key and generates a fresh one per write", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(200)])
    const client = _client(base)
    yield* client.execute(HttpClientRequest.post("/x").pipe(HttpClientRequest.setHeader("Idempotency-Key", "mine")))
    yield* client.execute(HttpClientRequest.post("/x"))
    yield* client.execute(HttpClientRequest.post("/x"))
    assert.strictEqual(seen[0]?.key, "mine")
    assert.notStrictEqual(seen[1]?.key, seen[2]?.key)
  }))

it.effect("stops retrying at the cap and returns the last response", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(429, { headers: { "Retry-After": "1" } })])
    const response = yield* _run(_client(base).execute(HttpClientRequest.get("/x")), 60_000)
    assert.strictEqual(response.status, 429)
    assert.strictEqual(seen.length, transportMaxRetries + 1)
  }))

it.effect("waits exactly the injected-jitter backoff before a retry", () =>
  Effect.gen(function*() {
    const { base, seen } = _scripted([_status(503), _status(200)])
    const client = makeGodaddyHttpClient({ base, token: Redacted.make("pat"), baseUrl: "https://fixture.invalid/v3/domains", jitter: () => 0.5 })
    const fiber = yield* Effect.forkChild(client.execute(HttpClientRequest.get("/x")))
    yield* Effect.yieldNow
    yield* TestClock.adjust(199)
    assert.strictEqual(seen.length, 1)
    yield* TestClock.adjust(1)
    const response = yield* Fiber.join(fiber)
    assert.strictEqual(response.status, 200)
    assert.strictEqual(seen.length, 2)
  }))

it.effect("consumes the discarded response body before retrying", () =>
  Effect.gen(function*() {
    const discarded = new Response("busy", { status: 503 })
    const { base } = _scripted([() => discarded, _status(200)])
    yield* _run(_client(base).execute(HttpClientRequest.get("/x")), 5000)
    assert.isTrue(discarded.bodyUsed)
  }))
