import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { logLine, withSpinner } from "../src/spinner.ts"

// Non-TTY here (test runner), so the spinner is inert — this checks the
// wrapper is transparent: value, error, and logLine output pass through.
describe("withSpinner", () => {
  it.effect("passes the result through", () =>
    Effect.gen(function*() {
      assert.strictEqual(yield* withSpinner({ label: "x", effect: Effect.succeed(42) }), 42)
    }))

  it.effect("passes failures through", () =>
    Effect.gen(function*() {
      const exit = yield* Effect.exit(withSpinner({ label: "x", effect: Effect.fail("boom") }))
      assert.isTrue(exit._tag === "Failure")
    }))

  it.effect("logLine writes the plain message when not a TTY", () =>
    Effect.gen(function*() {
      const writes: Array<string> = []
      const original = process.stdout.write.bind(process.stdout)
      const stub: typeof process.stdout.write = (chunk) => {
        writes.push(String(chunk))
        return true
      }
      process.stdout.write = stub
      yield* logLine("hello").pipe(
        Effect.ensuring(Effect.sync(() => {
          process.stdout.write = original
        }))
      )
      assert.deepStrictEqual(writes, ["hello\n"])
    }))
})
