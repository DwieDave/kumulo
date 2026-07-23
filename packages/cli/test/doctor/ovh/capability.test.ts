import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { regionVersionCapabilityCheck } from "../../../src/doctor/ovh/capability.ts"

it.effect("passes for a supported version", () =>
  Effect.gen(function*() {
    const result = yield* regionVersionCapabilityCheck({ region: "GRA9", version: "1.33" }).run
    assert.strictEqual(result.status, "pass")
  }))

it.effect("fails with an actionable message for an unsupported version", () =>
  Effect.gen(function*() {
    const result = yield* regionVersionCapabilityCheck({ region: "GRA9", version: "1.20" }).run
    assert.strictEqual(result.status, "fail")
    assert.match(result.message, /1\.20/)
  }))
