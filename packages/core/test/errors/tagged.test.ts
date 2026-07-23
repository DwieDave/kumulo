import { describe, expect, it } from "@effect/vitest"
import { Option, SchemaIssue } from "effect"
import {
  AddonInstallFailed,
  AuthenticationFailed,
  BootstrapFailed,
  CapabilityMissing,
  ConfigInvalid,
  HttpTransportError,
  PlanRejected,
  ProvisioningTimeout,
  QuotaExceeded,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "../../src/errors/tagged.ts"

describe("tagged errors", () => {
  it("HttpTransportError carries its tag and payload", () => {
    const error = new HttpTransportError({ cause: "boom" })
    expect(error._tag).toBe("HttpTransportError")
    expect(error.cause).toBe("boom")
  })

  it("ResponseDecodeError carries endpoint + issue", () => {
    const issue = new SchemaIssue.InvalidValue(Option.some("bad"), { message: "invalid" })
    const error = new ResponseDecodeError({ endpoint: "/x", issue })
    expect(error._tag).toBe("ResponseDecodeError")
    expect(error.endpoint).toBe("/x")
    expect(error.issue).toBe(issue)
  })

  it("AuthenticationFailed carries a hint", () => {
    const error = new AuthenticationFailed({ hint: "check creds" })
    expect(error._tag).toBe("AuthenticationFailed")
    expect(error.hint).toBe("check creds")
  })

  it("QuotaExceeded carries resource/limit/requested", () => {
    const error = new QuotaExceeded({ resource: "instances", limit: 10, requested: 20 })
    expect(error._tag).toBe("QuotaExceeded")
    expect(error.limit).toBe(10)
    expect(error.requested).toBe(20)
  })

  it("ResourceNotFound carries kind/ref", () => {
    const error = new ResourceNotFound({ kind: "server", ref: "abc" })
    expect(error._tag).toBe("ResourceNotFound")
    expect(error.ref).toBe("abc")
  })

  it("ResourceConflict carries kind/ref", () => {
    const error = new ResourceConflict({ kind: "server", ref: "abc" })
    expect(error._tag).toBe("ResourceConflict")
  })

  it("CapabilityMissing carries capability/region and optional workaround", () => {
    const error = new CapabilityMissing({ capability: "octavia", region: "GRA" })
    expect(error._tag).toBe("CapabilityMissing")
    expect(error.workaround).toBeUndefined()
  })

  it("ProvisioningTimeout carries lastStatus", () => {
    const error = new ProvisioningTimeout({ kind: "server", ref: "abc", lastStatus: "BUILD" })
    expect(error._tag).toBe("ProvisioningTimeout")
    expect(error.lastStatus).toBe("BUILD")
  })

  it("ConfigInvalid carries pathed issues", () => {
    const error = new ConfigInvalid({ issues: [{ path: ["a", 0], message: "bad" }] })
    expect(error._tag).toBe("ConfigInvalid")
    expect(error.issues).toHaveLength(1)
  })

  it("PlanRejected carries a reason", () => {
    const error = new PlanRejected({ reason: "no" })
    expect(error._tag).toBe("PlanRejected")
  })

  it("BootstrapFailed carries node/phase/log", () => {
    const error = new BootstrapFailed({ node: "n1", phase: "install", log: "..." })
    expect(error._tag).toBe("BootstrapFailed")
  })

  it("AddonInstallFailed carries addon/cause", () => {
    const error = new AddonInstallFailed({ addon: "cilium", cause: "x" })
    expect(error._tag).toBe("AddonInstallFailed")
  })
})
