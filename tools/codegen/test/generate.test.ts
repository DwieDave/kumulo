import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { generateSource } from "../src/generate.ts"
import { syntheticSpec } from "./fixtures.ts"

describe("generateSource", () => {
  it.effect("invokes the openapi-generator and returns non-empty source", () =>
    Effect.gen(function* () {
      const { source } = yield* generateSource({ spec: syntheticSpec, options: { name: "Widgets", format: "httpclient" } })
      expect(source.length).toBeGreaterThan(0)
      expect(source).toContain("Widgets")
    }))
})
