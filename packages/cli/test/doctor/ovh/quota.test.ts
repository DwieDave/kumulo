import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { planVsQuotaCheck } from "../../../src/doctor/ovh/quota.ts"
import { fakeMksListing, fakeMksStatus } from "./fake-mks.ts"

it.effect("passes when the plan fits within the quota", () =>
  Effect.gen(function*() {
    const check = planVsQuotaCheck({
      mks: fakeMksListing(["existing-1"]),
      serviceName: "service-1",
      plannedClusterCount: 1,
      maxClusters: 5
    })
    const result = yield* check.run
    assert.strictEqual(result.status, "pass")
    assert.match(result.message, /2\/5/)
  }))

it.effect("fails with an actionable message when the plan exceeds the quota", () =>
  Effect.gen(function*() {
    const check = planVsQuotaCheck({
      mks: fakeMksListing(["existing-1", "existing-2"]),
      serviceName: "service-1",
      plannedClusterCount: 1,
      maxClusters: 2
    })
    const result = yield* check.run
    assert.strictEqual(result.status, "fail")
    assert.match(result.message, /exceeding the quota of 2/)
  }))

it.effect("fails when existing clusters can't be read", () =>
  Effect.gen(function*() {
    const check = planVsQuotaCheck({
      mks: fakeMksStatus(500),
      serviceName: "service-1",
      plannedClusterCount: 1,
      maxClusters: 5
    })
    const result = yield* check.run
    assert.strictEqual(result.status, "fail")
    assert.match(result.message, /Could not read/)
  }))
