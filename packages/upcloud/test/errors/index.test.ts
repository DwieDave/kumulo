import {
  AuthenticationFailed,
  ProviderApiError,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound
} from "@kumulo/core"
import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { statusError } from "../../src/errors/index.ts"

const _at = (status: number, retryAfter?: string) => statusError({ status, kind: "cluster", ref: "kumulo-demo", body: "", retryAfter })

const _explicit: Record<number, new(...args: never) => object> = {
  401: AuthenticationFailed,
  402: QuotaExceeded,
  403: AuthenticationFailed,
  404: ResourceNotFound,
  409: ResourceConflict,
  429: RateLimited
}

describe("statusError", () => {
  it("maps the statuses R5 gives a distinct meaning", () => {
    for (const [status, tag] of Object.entries(_explicit)) {
      expect(_at(Number(status))).toBeInstanceOf(tag)
    }
  })

  it("carries the Retry-After verbatim on a 429", () => {
    expect(_at(429, "30")).toMatchObject({ kind: "cluster", ref: "kumulo-demo", retryAfter: "30" })
  })

  // R5 + N2: total over the whole HTTP status space — every code lands on
  // exactly one tagged error, and every status outside the explicit map is a
  // `ProviderApiError` that carries the real status rather than guessing.
  it.prop("every status in 100..599 maps to exactly one tagged error", [fc.integer({ min: 100, max: 599 })], ([status]) => {
    const error = _at(status)
    const expectedTag = _explicit[status]
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
