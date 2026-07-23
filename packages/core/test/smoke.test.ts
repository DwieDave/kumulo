import { assert, it } from "@effect/vitest"
import { Effect } from "effect"
import * as FastCheck from "effect/testing/FastCheck"
import { packageName } from "../src/index.ts"

it.effect("runs an Effect and resolves the package export", () =>
  Effect.gen(function* () {
    const result = yield* Effect.succeed(packageName)
    assert.strictEqual(result, "@kumulo/core")
  }))

it.prop("string concatenation length is additive", [FastCheck.string(), FastCheck.string()], ([a, b]) =>
  (a + b).length === a.length + b.length)
