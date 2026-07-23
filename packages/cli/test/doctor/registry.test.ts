import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { runChecks } from "../../src/doctor/registry.ts"
import type { DoctorCheck } from "../../src/doctor/types.ts"

const _check = (name: string, status: "pass" | "fail"): DoctorCheck => ({
  name,
  run: Effect.succeed({ name, status, message: `${name}: ${status}` })
})

it.effect("runs every check and collects results, failures included", () =>
  Effect.gen(function*() {
    const results = yield* runChecks([_check("a", "pass"), _check("b", "fail"), _check("c", "pass")])
    assert.strictEqual(results.length, 3)
    assert.deepStrictEqual(results.map((r) => r.status), ["pass", "fail", "pass"])
  }))
