import { ResourceNotFound } from "@kumulo/core"
import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { resourceResolutionCheck } from "../../src/doctor-openstack/resource-resolution.ts"

it.effect("passes when the image resolves", () =>
  Effect.gen(function*() {
    const check = resourceResolutionCheck({ kind: "image", ref: "ubuntu-22.04", resolve: Effect.succeed("img-1") })
    const result = yield* check.run
    assert.strictEqual(result.status, "pass")
    assert.match(result.message, /img-1/)
  }))

it.effect("fails with an actionable message when the flavor can't be resolved", () =>
  Effect.gen(function*() {
    const check = resourceResolutionCheck({
      kind: "flavor",
      ref: "b3-64",
      resolve: Effect.fail(new ResourceNotFound({ kind: "flavor", ref: "b3-64" }))
    })
    const result = yield* check.run
    assert.strictEqual(result.status, "fail")
    assert.match(result.message, /b3-64/)
    assert.match(result.message, /alias/)
  }))
