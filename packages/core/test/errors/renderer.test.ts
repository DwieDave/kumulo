import { describe, expect, it } from "@effect/vitest"
import type { RendererRegistry } from "../../src/errors/renderer.ts"
import { renderError } from "../../src/errors/renderer.ts"
import { QuotaExceeded } from "../../src/errors/tagged.ts"

const fullRegistry: RendererRegistry = {
  HttpTransportError: (e) => `transport error: ${String(e.cause)}`,
  ResponseDecodeError: (e) => `decode error at ${e.endpoint}`,
  AuthenticationFailed: (e) => `auth failed: ${e.hint}`,
  QuotaExceeded: (e) => `quota exceeded for ${e.resource}: limit ${e.limit}, requested ${e.requested}`,
  ResourceNotFound: (e) => `${e.kind} not found: ${e.ref}`,
  ResourceConflict: (e) => `${e.kind} conflict: ${e.ref}`,
  CapabilityMissing: (e) => `capability ${e.capability} missing in ${e.region}`,
  ProvisioningTimeout: (e) => `${e.kind} ${e.ref} timed out at ${e.lastStatus}`,
  ConfigInvalid: (e) => `config invalid: ${e.issues.length} issue(s)`,
  PlanRejected: (e) => `plan rejected: ${e.reason}`,
  BootstrapFailed: (e) => `bootstrap failed on ${e.node} at ${e.phase}`,
  AddonInstallFailed: (e) => `addon ${e.addon} failed: ${e.cause}`
}

describe("renderError", () => {
  it("dispatches to the renderer keyed by the error's tag", () => {
    const error = new QuotaExceeded({ resource: "instances", limit: 10, requested: 20 })
    expect(renderError({ registry: fullRegistry, error })).toBe(
      "quota exceeded for instances: limit 10, requested 20"
    )
  })

  it("a registry missing a tag is a compile error", () => {
    // @ts-expect-error missing ResourceConflict renderer must fail to typecheck
    const incompleteRegistry: RendererRegistry = {
      HttpTransportError: (e) => `transport error: ${String(e.cause)}`,
      ResponseDecodeError: (e) => `decode error at ${e.endpoint}`,
      AuthenticationFailed: (e) => `auth failed: ${e.hint}`,
      QuotaExceeded: (e) => `quota exceeded for ${e.resource}`,
      ResourceNotFound: (e) => `${e.kind} not found: ${e.ref}`,
      CapabilityMissing: (e) => `capability ${e.capability} missing in ${e.region}`,
      ProvisioningTimeout: (e) => `${e.kind} ${e.ref} timed out at ${e.lastStatus}`,
      ConfigInvalid: (e) => `config invalid: ${e.issues.length} issue(s)`,
      PlanRejected: (e) => `plan rejected: ${e.reason}`,
      BootstrapFailed: (e) => `bootstrap failed on ${e.node} at ${e.phase}`,
      AddonInstallFailed: (e) => `addon ${e.addon} failed: ${e.cause}`
    }
    expect(incompleteRegistry.HttpTransportError).toBeDefined()
  })
})
