import { describe, expect, it } from "@effect/vitest"
import {
  AuthenticationFailed,
  ProviderApiError,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound
} from "@kumulo/core"
import { Effect, Layer } from "effect"
import { FastCheck as fc } from "effect/testing"
import { CinderAuth } from "../src/auth.ts"
import { cinderRequest } from "../src/rest.ts"
import { makeFakeCinder } from "./fake-cinder.ts"

const _errorEffect = (status: number, body?: unknown, headers?: Record<string, string>) => {
  const fake = makeFakeCinder({ "GET /v3/volumes/vol-1": () => ({ status, body, headers }) })
  return Effect.provide(Effect.flip(cinderRequest({ path: "v3/volumes/vol-1", method: "GET", ref: "vol-1" })), fake.layer)
}

const _errorAt = (status: number, body?: unknown) => Effect.runPromise(_errorEffect(status, body))

// The auth port used to be typed `AuthenticationFailed` only, so a Keystone
// outage or rate limit was rewritten as "bad credentials" on the way through.
const _withAuth = (failure: ProviderApiError | RateLimited) =>
  Effect.runPromise(Effect.provide(
    Effect.flip(cinderRequest({ path: "v3/volumes/vol-1", method: "GET", ref: "vol-1" })),
    Layer.merge(
      makeFakeCinder({}).layer,
      Layer.succeed(CinderAuth, { token: Effect.fail(failure), endpoint: Effect.succeed("https://cinder.example.com/") })
    )
  ))

describe("CinderAuth port keeps the real failure tag", () => {
  it("a Keystone 5xx stays a ProviderApiError", async () => {
    const error = await _withAuth(new ProviderApiError({ operation: "keystone token", status: 503, body: "down" }))
    expect(error).toMatchObject({ _tag: "ProviderApiError", status: 503 })
    expect(error).not.toBeInstanceOf(AuthenticationFailed)
  })

  it("a Keystone rate limit stays a RateLimited", async () => {
    const error = await _withAuth(new RateLimited({ kind: "token", ref: "keystone", retryAfter: "5" }))
    expect(error).toMatchObject({ _tag: "RateLimited", retryAfter: "5" })
  })
})

describe("cinderRequest status mapping", () => {
  it("maps the statuses Cinder gives a distinct meaning", async () => {
    expect(await _errorAt(404)).toBeInstanceOf(ResourceNotFound)
    expect(await _errorAt(409)).toBeInstanceOf(ResourceConflict)
    expect(await _errorAt(401)).toBeInstanceOf(AuthenticationFailed)
    expect(await _errorAt(403)).toBeInstanceOf(AuthenticationFailed)
  })

  it("treats a 403 as quota only when the body says so, without fabricating a limit", async () => {
    const error = await _errorAt(403, { message: "VolumeSizeExceedsAvailableQuota" })
    expect(error).toBeInstanceOf(QuotaExceeded)
    expect(error).toMatchObject({ resource: "volume" })
    if (error._tag !== "QuotaExceeded") throw new Error(`expected QuotaExceeded, got ${error._tag}`)
    expect(error.limit).toBeUndefined()
  })

  it("reports 429 and 413 as rate limiting, not as an auth failure", async () => {
    const error = await _errorAt(429, { message: "slow down" })
    expect(error).toBeInstanceOf(RateLimited)
    expect(error).not.toBeInstanceOf(AuthenticationFailed)
    expect(await _errorAt(413, { message: "over limit" })).toBeInstanceOf(RateLimited)
  })

  it("carries Retry-After verbatim when Cinder sends one", async () => {
    const error = await Effect.runPromise(_errorEffect(429, { message: "slow down" }, { "retry-after": "17" }))
    expect(error).toMatchObject({ _tag: "RateLimited", retryAfter: "17" })
  })

  it("reports 422 as a provider error carrying the status", async () => {
    expect(await _errorAt(422, { message: "invalid size" })).toMatchObject({ _tag: "ProviderApiError", status: 422 })
  })

  // A Cinder outage must never read as "bad credentials" to an operator.
  it.effect.prop("every 5xx is a provider error carrying the real status", [fc.integer({ min: 500, max: 599 })], ([status]) =>
    Effect.gen(function*() {
      const error = yield* _errorEffect(status, { message: "boom" })
      expect(error).toBeInstanceOf(ProviderApiError)
      expect(error).not.toBeInstanceOf(AuthenticationFailed)
      expect(error).toMatchObject({ status, operation: "volume vol-1" })
    }))
})
