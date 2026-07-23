import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { authValidityCheck } from "../../../src/doctor/ovh/auth.ts"
import { fakeMksListing, fakeMksStatus } from "./fake-mks.ts"

it.effect("passes when credentials are accepted", () =>
  Effect.gen(function*() {
    const check = authValidityCheck({ mks: fakeMksListing([]), serviceName: "service-1" })
    const result = yield* check.run
    assert.strictEqual(result.status, "pass")
  }))

it.effect("fails with an actionable message on 401", () =>
  Effect.gen(function*() {
    const check = authValidityCheck({ mks: fakeMksStatus(401), serviceName: "service-1" })
    const result = yield* check.run
    assert.strictEqual(result.status, "fail")
    assert.match(result.message, /credentials/i)
  }))

it.effect("does not treat a 403 as an auth failure", () =>
  Effect.gen(function*() {
    const check = authValidityCheck({ mks: fakeMksStatus(403), serviceName: "service-1" })
    const result = yield* check.run
    assert.strictEqual(result.status, "pass")
  }))
