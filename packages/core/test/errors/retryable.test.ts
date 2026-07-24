import { describe, expect, it } from "@effect/vitest"
import { Option, SchemaIssue } from "effect"
import {
  AddonInstallFailed,
  AuthenticationFailed,
  BootstrapFailed,
  BucketNotEmpty,
  CapabilityMissing,
  ConfigInvalid,
  HttpTransportError,
  PlanRejected,
  ProvisioningTimeout,
  QuotaExceeded,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError,
  SinkUnavailable
} from "../../src/errors/tagged.ts"
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

  it("matches the full retryableByTag table for every remaining tag", () => {
    const issue = new SchemaIssue.InvalidValue(Option.some("bad"), { message: "invalid" })
    expect(isRetryable(new ResponseDecodeError({ endpoint: "/x", issue }))).toBe(false)
    expect(isRetryable(new AuthenticationFailed({ hint: "x" }))).toBe(false)
    expect(isRetryable(new ResourceNotFound({ kind: "server", ref: "a" }))).toBe(false)
    expect(isRetryable(new CapabilityMissing({ capability: "x", region: "gra" }))).toBe(false)
    expect(isRetryable(new ConfigInvalid({ issues: [] }))).toBe(false)
    expect(isRetryable(new PlanRejected({ reason: "x" }))).toBe(false)
    expect(isRetryable(new BootstrapFailed({ node: "n", phase: "p", log: "l" }))).toBe(false)
    expect(isRetryable(new AddonInstallFailed({ addon: "x", cause: "x" }))).toBe(false)
    expect(isRetryable(new BucketNotEmpty({ bucket: "b", objectCount: 1 }))).toBe(false)
    expect(isRetryable(new SinkUnavailable({ hint: "x" }))).toBe(false)
  })
})
