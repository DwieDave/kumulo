import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { checkNoop } from "../src/regenCheck.ts"

describe("checkNoop", () => {
  it.effect("succeeds when regenerated output matches the committed file", () =>
    Effect.gen(function* () {
      yield* checkNoop({
        committedPath: "generated/widgets.ts",
        committed: "export const x = 1\n",
        regenerated: "export const x = 1\n"
      })
    }))

  it.effect("fails loudly with the first differing line on drift", () =>
    Effect.gen(function* () {
      const result = yield* Effect.flip(
        checkNoop({
          committedPath: "generated/widgets.ts",
          committed: "line1\nline2\nline3\n",
          regenerated: "line1\nCHANGED\nline3\n"
        })
      )
      expect(result._tag).toEqual("DriftDetected")
      expect(result.committedPath).toEqual("generated/widgets.ts")
      expect(result.firstDiffLine).toEqual(2)
    }))
})
