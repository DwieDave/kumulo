import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { authMethodsByProvider } from "../../src/config/schema.ts"
import type { AuthMethod, Provider } from "../../src/config/schema.ts"

// T1.2 — isAuthMethodConsistentWithProvider becomes a per-provider
// allowed-methods map (D5, R16): hetzner and upcloud -> api_token only,
// ovh and generic -> the OpenStack-style methods.
const providers: ReadonlyArray<Provider> = ["ovh", "generic", "hetzner", "upcloud"]
const methods: ReadonlyArray<AuthMethod> = ["application_credential", "clouds_yaml", "env", "api_token"]

describe("authMethodsByProvider", () => {
  it("hetzner and upcloud allow only api_token", () => {
    expect(authMethodsByProvider.hetzner).toEqual(["api_token"])
    expect(authMethodsByProvider.upcloud).toEqual(["api_token"])
  })

  it("ovh and generic allow the OpenStack-style methods, not api_token", () => {
    for (const provider of ["ovh", "generic"] as const) {
      expect(authMethodsByProvider[provider]).toEqual(
        expect.arrayContaining(["application_credential", "clouds_yaml", "env"])
      )
      expect(authMethodsByProvider[provider]).not.toContain("api_token")
    }
  })

  // Ground truth independent of the implementation under test.
  const expected: Record<Provider, ReadonlyArray<AuthMethod>> = {
    hetzner: ["api_token"],
    upcloud: ["api_token"],
    ovh: ["application_credential", "clouds_yaml", "env"],
    generic: ["application_credential", "clouds_yaml", "env"]
  }

  it.prop(
    "for every (provider, method) pair, the map accepts exactly the pairs in the ground truth",
    [fc.constantFrom(...providers), fc.constantFrom(...methods)],
    ([provider, method]) => {
      const actual = authMethodsByProvider[provider].includes(method)
      const wanted = expected[provider].includes(method)
      return actual === wanted
    }
  )
})
