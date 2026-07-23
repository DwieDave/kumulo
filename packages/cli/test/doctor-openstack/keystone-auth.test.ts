import { AuthenticationFailed } from "@kumulo/core"
import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { keystoneAuthCheck } from "../../src/doctor-openstack/keystone-auth.ts"

it.effect("passes when a token is issued", () =>
  Effect.gen(function*() {
    const check = keystoneAuthCheck({ token: Effect.succeed("tok") })
    const result = yield* check.run
    assert.strictEqual(result.status, "pass")
  }))

it.effect("fails with an actionable message when auth fails", () =>
  Effect.gen(function*() {
    const check = keystoneAuthCheck({
      token: Effect.fail(new AuthenticationFailed({ hint: "keystone token issue failed with status 401" }))
    })
    const result = yield* check.run
    assert.strictEqual(result.status, "fail")
    assert.match(result.message, /OS_\* env vars or clouds\.yaml/)
    assert.match(result.message, /401/)
  }))
