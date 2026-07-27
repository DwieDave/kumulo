import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { deleteVolume } from "../../src/volume/provider.ts"
import { resolveFlavor } from "../../src/provider/cloud-provider.ts"
import { makeFakeHcloud } from "./fake-hcloud.ts"
import * as fixture from "./fixtures.ts"

const _statusFails = (
  { headers, status }: { readonly status: number; readonly headers?: Record<string, string> }
) => {
  const fake = makeFakeHcloud({
    "GET /server_types": () => ({ status, body: { error: { code: "not_found", message: "nope" } }, headers })
  })
  return Effect.flip(resolveFlavor({ ref: "cx22" })).pipe(Effect.provide(fake.layer))
}

describe("hcloud error taxonomy", () => {
  it.effect("401/403 map to AuthenticationFailed, not a fabricated quota", () =>
    Effect.gen(function*() {
      expect((yield* _statusFails({ status: 401 }))._tag).toBe("AuthenticationFailed")
      expect((yield* _statusFails({ status: 403 }))._tag).toBe("AuthenticationFailed")
    }))

  it.effect("404 maps to ResourceNotFound and 409/423 to ResourceConflict", () =>
    Effect.gen(function*() {
      expect((yield* _statusFails({ status: 404 }))._tag).toBe("ResourceNotFound")
      expect((yield* _statusFails({ status: 409 }))._tag).toBe("ResourceConflict")
      expect((yield* _statusFails({ status: 423 }))._tag).toBe("ResourceConflict")
    }))

  it.effect("429 maps to RateLimited carrying Retry-After", () =>
    Effect.gen(function*() {
      const failure = yield* _statusFails({ status: 429, headers: { "retry-after": "7" } })
      expect(failure._tag).toBe("RateLimited")
      expect(failure._tag === "RateLimited" ? failure.retryAfter : undefined).toBe("7")
    }))

  it.effect("429 falls back to RateLimit-Reset when Retry-After is absent", () =>
    Effect.gen(function*() {
      const failure = yield* _statusFails({ status: 429, headers: { "ratelimit-reset": "1800000000" } })
      expect(failure._tag === "RateLimited" ? failure.retryAfter : undefined).toBe("1800000000")
    }))

  it.effect("422 and 5xx surface as ProviderApiError with the real status and body", () =>
    Effect.gen(function*() {
      const validation = yield* _statusFails({ status: 422 })
      expect(validation._tag).toBe("ProviderApiError")
      expect(validation._tag === "ProviderApiError" ? validation.status : 0).toBe(422)
      const outage = yield* _statusFails({ status: 503 })
      expect(outage._tag).toBe("ProviderApiError")
      expect(outage._tag === "ProviderApiError" ? outage.body : "").toContain("not_found")
    }))

  // `QuotaExceeded` is raised only on hcloud's own quota error code — and
  // without the `limit: 0`/`requested: 0` placeholders it used to fabricate.
  it.effect("a genuine quota signal maps to QuotaExceeded with honest fields", () =>
    Effect.gen(function*() {
      const fake = makeFakeHcloud({
        "GET /server_types": () => ({
          status: 403,
          body: { error: { code: "resource_limit_exceeded", message: "server limit reached" } }
        })
      })
      const failure = yield* Effect.flip(resolveFlavor({ ref: "cx22" })).pipe(Effect.provide(fake.layer))
      expect(failure._tag).toBe("QuotaExceeded")
      expect(failure._tag === "QuotaExceeded" ? failure.limit : 0).toBeUndefined()
    }))

  it.effect("a malformed response body maps to ResponseDecodeError", () =>
    Effect.gen(function*() {
      const fake = makeFakeHcloud({
        "GET /server_types": () => ({ status: 200, body: { server_types: [{ id: "not-a-number" }], meta: fixture.meta() } })
      })
      const failure = yield* Effect.flip(resolveFlavor({ ref: "cx22" })).pipe(Effect.provide(fake.layer))
      expect(failure._tag).toBe("ResponseDecodeError")
    }))

  it.effect("VolumeProvider shares the same taxonomy", () =>
    Effect.gen(function*() {
      const fake = makeFakeHcloud({ "DELETE /volumes/1": () => ({ status: 500, body: { error: { code: "boom", message: "x" } } }) })
      const failure = yield* Effect.flip(deleteVolume({ id: "1" })).pipe(Effect.provide(fake.layer))
      expect(failure._tag).toBe("ProviderApiError")
    }))
})
