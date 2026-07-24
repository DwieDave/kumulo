import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { fetchNovaLimits, quotaHeadroomCheck } from "../../src/doctor-openstack/quota.ts"
import { fakeEndpointResolver, fakeHttpClient } from "./fake-openstack.ts"

it.effect("passes when the plan fits within the quota", () =>
  Effect.gen(function*() {
    const limits = fetchNovaLimits({
      client: fakeHttpClient({ status: 200, body: { limits: { absolute: { maxTotalInstances: 10, totalInstancesUsed: 3 } } } }),
      keystone: fakeEndpointResolver(),
      region: "GRA9"
    })
    const result = yield* quotaHeadroomCheck({ limits, plannedInstanceCount: 5 }).run
    assert.strictEqual(result.status, "pass")
    assert.match(result.message, /8\/10/)
  }))

it.effect("fails with an actionable message when the plan exceeds the quota", () =>
  Effect.gen(function*() {
    const limits = fetchNovaLimits({
      client: fakeHttpClient({ status: 200, body: { limits: { absolute: { maxTotalInstances: 5, totalInstancesUsed: 3 } } } }),
      keystone: fakeEndpointResolver(),
      region: "GRA9"
    })
    const result = yield* quotaHeadroomCheck({ limits, plannedInstanceCount: 5 }).run
    assert.strictEqual(result.status, "fail")
    assert.match(result.message, /exceeding the quota of 5/)
  }))

it.effect("passes when Nova reports no quota limit (-1)", () =>
  Effect.gen(function*() {
    const limits = fetchNovaLimits({
      client: fakeHttpClient({ status: 200, body: { limits: { absolute: { maxTotalInstances: -1, totalInstancesUsed: 3 } } } }),
      keystone: fakeEndpointResolver(),
      region: "GRA9"
    })
    const result = yield* quotaHeadroomCheck({ limits, plannedInstanceCount: 5 }).run
    assert.strictEqual(result.status, "pass")
    assert.match(result.message, /no quota limit reported/)
  }))

it.effect("treats a malformed limits.absolute shape as unknown quota (lenient decode, not a false failure)", () =>
  Effect.gen(function*() {
    const limits = fetchNovaLimits({
      client: fakeHttpClient({ status: 200, body: { limits: { absolute: "not-an-object" } } }),
      keystone: fakeEndpointResolver(),
      region: "GRA9"
    })
    const result = yield* quotaHeadroomCheck({ limits, plannedInstanceCount: 5 }).run
    assert.strictEqual(result.status, "pass")
    assert.match(result.message, /no quota limit reported/)
  }))

it.effect("treats an unreachable limits endpoint as unknown quota (pass, not a false failure)", () =>
  Effect.gen(function*() {
    const limits = fetchNovaLimits({
      client: fakeHttpClient({ status: 500 }),
      keystone: fakeEndpointResolver(),
      region: "GRA9"
    })
    const result = yield* quotaHeadroomCheck({ limits, plannedInstanceCount: 5 }).run
    assert.strictEqual(result.status, "pass")
  }))
