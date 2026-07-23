import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { applyPatches } from "../src/patch.ts"
import { syntheticSpec } from "./fixtures.ts"

describe("applyPatches", () => {
  it.effect("applies a patch on top of the spec", () =>
    Effect.gen(function* () {
      const patched = yield* applyPatches({
        patches: [{ source: "test.patch.json", patch: [{ op: "replace", path: "/info/title", value: "Patched" }] }],
        document: syntheticSpec
      })
      expect(patched).toMatchObject({ info: { title: "Patched" } })
    }))

  it.effect("fails loudly listing every unapplicable operation", () =>
    Effect.gen(function* () {
      const result = yield* Effect.flip(
        applyPatches({
          patches: [
            {
              source: "bad.patch.json",
              patch: [
                { op: "replace", path: "/info/doesNotExist", value: "x" },
                { op: "remove", path: "/paths/doesNotExist" }
              ]
            }
          ],
          document: syntheticSpec
        })
      )
      expect(result._tag).toEqual("JsonPatchAggregateError")
      expect(result.errors.length).toEqual(2)
    }))
})
