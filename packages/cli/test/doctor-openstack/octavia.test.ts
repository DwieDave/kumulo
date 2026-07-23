import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { octaviaCapabilityCheck } from "../../src/doctor-openstack/octavia.ts"

it.effect("passes when Octavia is available in the region", () =>
  Effect.gen(function*() {
    const result = yield* octaviaCapabilityCheck({ region: "GRA9", supported: true }).run
    assert.strictEqual(result.status, "pass")
    assert.match(result.message, /GRA9/)
  }))

it.effect("fails with an actionable message when Octavia is missing", () =>
  Effect.gen(function*() {
    const result = yield* octaviaCapabilityCheck({ region: "BHS5", supported: false }).run
    assert.strictEqual(result.status, "fail")
    assert.match(result.message, /BHS5/)
    assert.match(result.message, /high_availability/)
  }))
