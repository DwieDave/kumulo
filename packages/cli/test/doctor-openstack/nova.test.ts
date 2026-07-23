import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { microversionCheck, NOVA_MICROVERSION, probeMicroversion } from "../../src/doctor-openstack/nova.ts"
import { fakeEndpointResolver, fakeHttpClient } from "./fake-openstack.ts"

it.effect("passes when Nova accepts the pinned microversion", () =>
  Effect.gen(function*() {
    const probe = probeMicroversion({
      client: fakeHttpClient({ status: 200 }),
      keystone: fakeEndpointResolver(),
      region: "GRA9",
      microversion: NOVA_MICROVERSION
    })
    const result = yield* microversionCheck({ probe, microversion: NOVA_MICROVERSION }).run
    assert.strictEqual(result.status, "pass")
  }))

it.effect("fails with an actionable message on a 406", () =>
  Effect.gen(function*() {
    const probe = probeMicroversion({
      client: fakeHttpClient({ status: 406 }),
      keystone: fakeEndpointResolver(),
      region: "GRA9",
      microversion: NOVA_MICROVERSION
    })
    const result = yield* microversionCheck({ probe, microversion: NOVA_MICROVERSION }).run
    assert.strictEqual(result.status, "fail")
    assert.match(result.message, /rejected microversion/)
  }))

it.effect("fails when Nova is unreachable", () =>
  Effect.gen(function*() {
    const probe = probeMicroversion({
      client: fakeHttpClient({ status: 500 }),
      keystone: fakeEndpointResolver(),
      region: "GRA9",
      microversion: NOVA_MICROVERSION
    })
    const result = yield* microversionCheck({ probe, microversion: NOVA_MICROVERSION }).run
    assert.strictEqual(result.status, "fail")
    assert.match(result.message, /Could not reach Nova/)
  }))
