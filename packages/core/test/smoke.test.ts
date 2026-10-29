import { assert, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { packageName } from "../src/index.ts"

it.effect("runs an Effect and resolves the package export", () =>
  Effect.gen(function* () {
    const result = yield* Effect.succeed(packageName)
    assert.strictEqual(result, "@kumulo/core")
  }))

it.prop("string concatenation length is additive", [Schema.String, Schema.String], ([a, b]) =>
  (a + b).length === a.length + b.length)
