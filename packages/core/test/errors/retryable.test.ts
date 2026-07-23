import { describe, expect, it } from "@effect/vitest"
import { HttpTransportError, ProvisioningTimeout, QuotaExceeded, ResourceConflict } from "../../src/errors/tagged.ts"
import { isRetryable } from "../../src/errors/retryable.ts"

describe("isRetryable", () => {
  it("treats transient/conflict errors as retryable", () => {
    expect(isRetryable(new HttpTransportError({ cause: "x" }))).toBe(true)
    expect(isRetryable(new ResourceConflict({ kind: "server", ref: "a" }))).toBe(true)
    expect(isRetryable(new ProvisioningTimeout({ kind: "server", ref: "a", lastStatus: "BUILD" }))).toBe(true)
  })

  it("treats quota/auth errors as terminal", () => {
    expect(isRetryable(new QuotaExceeded({ resource: "instances", limit: 1, requested: 2 }))).toBe(false)
  })
})
