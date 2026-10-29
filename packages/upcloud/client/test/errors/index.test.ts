import {
  AuthenticationFailed,
  ProviderApiError,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound
} from "@kumulo/core"
import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { statusError, upcloudErrorCode } from "../../src/errors/index.ts"

const _at = (status: number, retryAfter?: string) => statusError({ status, kind: "cluster", ref: "kumulo-demo", body: "", retryAfter })

const _explicit = new Map<number, new(...args: never) => object>([
  [401, AuthenticationFailed],
  [402, QuotaExceeded],
  [403, AuthenticationFailed],
  [404, ResourceNotFound],
  [409, ResourceConflict],
  [429, RateLimited]
])

describe("statusError", () => {
  it("maps the statuses R5 gives a distinct meaning", () => {
    for (const [status, tag] of _explicit.entries()) {
      expect(_at(status)).toBeInstanceOf(tag)
    }
  })

  it.each(["STORAGE_LIMIT_REACHED", "NETWORK_LIMIT_REACHED"])("reports a 403 %s as a quota error", (code) => {
    const body = JSON.stringify({ error: { error_code: code, error_message: "x" } })
    const error = statusError({ status: 403, kind: "storage", ref: "r", body, retryAfter: undefined })
    expect(error).toBeInstanceOf(QuotaExceeded)
    expect(error).toMatchObject({ resource: "storage" })
  })

  it("keeps other 403 bodies as AuthenticationFailed", () => {
    const body = JSON.stringify({ error: { error_code: "INSUFFICIENT_PERMISSIONS" } })
    expect(statusError({ status: 403, kind: "storage", ref: "r", body, retryAfter: undefined })).toBeInstanceOf(AuthenticationFailed)
  })

  it("upcloudErrorCode ignores bodies that are not the classic shape", () => {
    expect(upcloudErrorCode("not json")).toBeUndefined()
    expect(upcloudErrorCode(JSON.stringify({ type: "x", title: "y" }))).toBeUndefined()
    expect(upcloudErrorCode(JSON.stringify({ error: { error_code: "A" } }))).toBe("A")
  })

  it("carries the Retry-After verbatim on a 429", () => {
    expect(_at(429, "30")).toMatchObject({ kind: "cluster", ref: "kumulo-demo", retryAfter: "30" })
  })

  // R5 + N2: total over the whole HTTP status space — every code lands on
  // exactly one tagged error, and every status outside the explicit map is a
  // `ProviderApiError` that carries the real status rather than guessing.
  it.prop("every status in 100..599 maps to exactly one tagged error", [Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 }))], ([status]) => {
    const error = _at(status)
    const expectedTag = _explicit.get(status)

    if (expectedTag === undefined) {
      expect(error).toBeInstanceOf(ProviderApiError)
      expect(error).toMatchObject({ status })
    } else {
      expect(error).toBeInstanceOf(expectedTag)
    }

    // Exactly one: never both the specific tag and the catch-all.
    const isCatchAll = error instanceof ProviderApiError
    const isSpecific = expectedTag !== undefined && error instanceof expectedTag
    expect(isCatchAll !== isSpecific).toBe(true)
  })

  it("keeps unclassified statuses distinguishable by their real status code", () => {
    expect(_at(422)).toMatchObject({ status: 422 })
    expect(_at(500)).toMatchObject({ status: 500 })
  })
})
