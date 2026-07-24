import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { generateSource } from "../src/generate.ts"
import { syntheticSpec, syntheticSpecWithFreeformAdditionalProperties } from "./fixtures.ts"

describe("generateSource", () => {
  it.effect("invokes the openapi-generator and returns non-empty source", () =>
    Effect.gen(function* () {
      const { source } = yield* generateSource({ spec: syntheticSpec, options: { name: "Widgets", format: "httpclient" } })
      expect(source.length).toBeGreaterThan(0)
      expect(source).toContain("Widgets")
    }))

  // kumulo: WHY close free-form additionalProperties — OpenStack vendor-extension
  // `additionalProperties: { type: "string" }` (e.g. Glance's image extra-properties, Nova's
  // scheduler_hints) combined with typed optional sibling keys produces TypeScript that
  // doesn't compile (TS2411: optional key vs. plain index signature). Unknown fields are
  // handled leniently at the transport layer anyway, so the schema itself doesn't need to
  // type them — generateSource forces such `additionalProperties` closed (`false`) before
  // handing the spec to the generator.
  it.effect("closes free-form additionalProperties so the generated TS still compiles", () =>
    Effect.gen(function* () {
      const { source } = yield* generateSource({
        spec: syntheticSpecWithFreeformAdditionalProperties,
        options: { name: "Widgets", format: "httpapi" }
      })
      expect(source).not.toContain("[x: string]: string")
    }))
})
