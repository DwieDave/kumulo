import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Fiber, Predicate } from "effect"
import { TestClock } from "effect/testing"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { makeProviderHttpClient } from "../../src/http/client.ts"
import { classifyHttpError, ignoreNotFound } from "../../src/http/errors.ts"
import { parseRateLimitResetAt, parseRetryAfterAt } from "../../src/http/retry-after.ts"
import { QuotaExceeded, ResourceNotFound } from "../../src/errors/tagged.ts"

const _scripted = (statuses: ReadonlyArray<number>, headers: Record<string, string> = {}) => {
  const calls: Array<string> = []

  const base = HttpClient.make((request) => {
    const status = statuses[Math.min(calls.length, statuses.length - 1)] ?? 200
    calls.push(request.method)

    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("", { status, headers })))
  })

  return { base, calls }
}

const _run = (client: HttpClient.HttpClient, method: "GET" | "POST") =>
  Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(client.execute(HttpClientRequest.make(method)("http://x/y")))
    yield* TestClock.adjust("10 minutes")

    return yield* Fiber.join(fiber)
  })

describe("makeProviderHttpClient", () => {
  it.effect("prepends baseUrl to relative request URLs", () =>
    Effect.gen(function*() {
      const urls: Array<string> = []

      const base = HttpClient.make((request) => {
        urls.push(request.url)

        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("", { status: 200 })))
      })

      const client = yield* makeProviderHttpClient({ base, baseUrl: "https://api.example.com" })
      yield* client.execute(HttpClientRequest.get("/zones"))
      expect(urls).toEqual(["https://api.example.com/zones"])
    }))

  it.effect("retries GET on 503", () =>
    Effect.gen(function*() {
      const { base, calls } = _scripted([503, 503, 200])
      const response = yield* _run(yield* makeProviderHttpClient({ base }), "GET")
      expect(response.status).toBe(200)
      expect(calls).toHaveLength(3)
    }))

  it.effect("never retries POST by default", () =>
    Effect.gen(function*() {
      const { base, calls } = _scripted([503, 200])
      const response = yield* _run(yield* makeProviderHttpClient({ base }), "POST")
      expect(response.status).toBe(503)
      expect(calls).toHaveLength(1)
    }))

  it.effect("retries POST when opted in", () =>
    Effect.gen(function*() {
      const { base, calls } = _scripted([503, 200])
      const client = yield* makeProviderHttpClient({ base, retry: { methods: ["POST"] } })
      expect((yield* _run(client, "POST")).status).toBe(200)
      expect(calls).toHaveLength(2)
    }))

  it.effect("caps Retry-After waits at maxDelay", () =>
    Effect.gen(function*() {
      const { base, calls } = _scripted([429, 200], { "retry-after": "3600" })
      const client = yield* makeProviderHttpClient({ base, retry: { maxDelay: "5 seconds" } })
      const fiber = yield* Effect.forkChild(client.execute(HttpClientRequest.get("http://x/y")))
      yield* TestClock.adjust("6 seconds")
      expect((yield* Fiber.join(fiber)).status).toBe(200)
      expect(calls).toHaveLength(2)
    }))

  it.effect("re-authorizes once on 401", () =>
    Effect.gen(function*() {
      const { base, calls } = _scripted([401, 200])
      let refreshed = 0
      const client = yield* makeProviderHttpClient({ base, onUnauthorized: Effect.sync(() => void refreshed++) })
      expect((yield* _run(client, "GET")).status).toBe(200)
      expect(refreshed).toBe(1)
      expect(calls).toHaveLength(2)
    }))
})

describe("retry-after parsing", () => {
  it("parses delta seconds", () => {
    expect(Duration.toMillis(parseRetryAfterAt({ value: "7", nowMs: 0 }) ?? Duration.zero)).toBe(7000)
  })
  it("parses HTTP dates", () => {
    const now = Date.parse("Wed, 21 Oct 2026 07:28:00 GMT")
    const d = parseRetryAfterAt({ value: "Wed, 21 Oct 2026 07:28:30 GMT", nowMs: now })
    expect(Duration.toMillis(d ?? Duration.zero)).toBe(30_000)
  })
  it("rejects garbage", () => {
    expect(parseRetryAfterAt({ value: "soon", nowMs: 0 })).toBeUndefined()
    expect(parseRetryAfterAt({ value: undefined, nowMs: 0 })).toBeUndefined()
  })
  it("handles RateLimit-Reset as delta or absolute", () => {
    expect(Duration.toMillis(parseRateLimitResetAt({ value: "12", nowMs: 0 }) ?? Duration.zero)).toBe(12_000)
    const d = parseRateLimitResetAt({ value: "2000000010", nowMs: 2_000_000_000_000 })
    expect(Duration.toMillis(d ?? Duration.zero)).toBe(10_000)
  })
})

describe("classifyHttpError", () => {
  const base = { kind: "server", ref: "s1", body: "boom" }
  const tag = (status: number) => classifyHttpError({ ...base, status })._tag

  it("maps the status table", () => {
    expect(tag(401)).toBe("AuthenticationFailed")
    expect(tag(403)).toBe("AuthenticationFailed")
    expect(tag(404)).toBe("ResourceNotFound")
    expect(tag(409)).toBe("ResourceConflict")
    expect(tag(413)).toBe("RateLimited")
    expect(tag(429)).toBe("RateLimited")
    expect(tag(422)).toBe("ProviderApiError")
    expect(tag(500)).toBe("ProviderApiError")
  })
  it("carries retryAfter", () => {
    const e = classifyHttpError({ ...base, status: 429, retryAfter: "5" })
    expect(Predicate.isTagged(e, "RateLimited") && e.retryAfter).toBe("5")
  })
  it("truncates bodies to 512 chars", () => {
    const e = classifyHttpError({ ...base, status: 500, body: "x".repeat(2000) })
    expect(Predicate.isTagged(e, "ProviderApiError") && e.body.length).toBe(512)
  })
  it("isQuota wins over the default table", () => {
    const e = classifyHttpError({ ...base, status: 403, isQuota: ({ body }) => body === "boom" })
    expect(e).toBeInstanceOf(QuotaExceeded)
  })
  it("override wins first", () => {
    const e = classifyHttpError({ ...base, status: 500, override: () => new ResourceNotFound({ kind: "k", ref: "r" }) })
    expect(e._tag).toBe("ResourceNotFound")
  })
  it.effect("ignoreNotFound swallows only ResourceNotFound", () =>
    Effect.gen(function*() {
      yield* ignoreNotFound(Effect.fail(new ResourceNotFound({ kind: "k", ref: "r" })))
      const other = yield* Effect.flip(ignoreNotFound(Effect.fail(classifyHttpError({ ...base, status: 500 }))))
      expect(other._tag).toBe("ProviderApiError")
    }))
})
