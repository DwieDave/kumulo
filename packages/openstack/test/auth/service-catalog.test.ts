import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { catalogOf, resolveEndpoint } from "../../src/auth/service-catalog.ts"

describe("catalogOf", () => {
  it("defaults the fields the token response omits", () => {
    const catalog = catalogOf({
      token: { catalog: [{ type: "compute", endpoints: [{ interface: "public", url: "https://nova.example.com" }] }] }
    })
    expect(catalog).toEqual([
      { type: "compute", endpoints: [{ interface: "public", region: "", url: "https://nova.example.com" }] }
    ])
  })

  // The token envelope is decoded by the generated Keystone client now, so a
  // catalog-less response is no longer a decode failure — it simply resolves
  // nothing, which must still be an error and never a silent empty endpoint.
  it("resolves nothing when the token carries no catalog", async () => {
    const exit = await Effect.runPromiseExit(
      resolveEndpoint({ catalog: catalogOf({ token: {} }), service: "compute", region: "gra" })
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("resolveEndpoint", () => {
  it.effect("falls back to any public endpoint when the region doesn't match", () =>
    Effect.gen(function*() {
      const url = yield* resolveEndpoint({
        catalog: [{ type: "compute", endpoints: [{ interface: "public", region: "bhs", url: "https://nova.bhs.example.com" }] }],
        service: "compute",
        region: "gra"
      })
      expect(url).toBe("https://nova.bhs.example.com")
    }))
})
