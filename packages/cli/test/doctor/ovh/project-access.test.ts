import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { projectAccessCheck } from "../../../src/doctor/ovh/project-access.ts"
import { fakeMksListing, fakeMksStatus } from "./fake-mks.ts"

it.effect("passes when the project is reachable", () =>
  Effect.gen(function*() {
    const check = projectAccessCheck({ mks: fakeMksListing([]), serviceName: "service-1" })
    const result = yield* check.run
    assert.strictEqual(result.status, "pass")
  }))

it.effect("fails with an actionable message on 403", () =>
  Effect.gen(function*() {
    const check = projectAccessCheck({ mks: fakeMksStatus(403), serviceName: "service-1" })
    const result = yield* check.run
    assert.strictEqual(result.status, "fail")
    assert.match(result.message, /access/i)
  }))

it.effect("fails on 401 too, deferring to the auth check", () =>
  Effect.gen(function*() {
    const check = projectAccessCheck({ mks: fakeMksStatus(401), serviceName: "service-1" })
    const result = yield* check.run
    assert.strictEqual(result.status, "fail")
    assert.match(result.message, /authentication/i)
  }))
