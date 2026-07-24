import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { parseCatalog, resolveEndpoint } from "../../src/auth/service-catalog.ts"

describe("parseCatalog", () => {
  it.effect("decodes a catalog, defaulting fields the response omits", () =>
    Effect.gen(function*() {
      const catalog = yield* parseCatalog({
        token: { catalog: [{ type: "compute", endpoints: [{ interface: "public", url: "https://nova.example.com" }] }] }
      })
      expect(catalog).toEqual([
        { type: "compute", endpoints: [{ interface: "public", region: "", url: "https://nova.example.com" }] }
      ])
    }))

  it("fails with ResponseDecodeError when token.catalog is missing/malformed", async () => {
    const exit = await Effect.runPromiseExit(parseCatalog({ token: {} }))
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
