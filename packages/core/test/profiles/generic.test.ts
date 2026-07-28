import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { genericProfile } from "../../src/profiles/generic.ts"
import type { ClusterConfigShape } from "../../src/domain/types.ts"

const baseConfig: ClusterConfigShape = {
  distro: "k3s",
  worker_pools: [],
  addons: { cni: "flannel" },
  auth: { region: "anywhere" },
  api_server: { high_availability: true },
  volumes: { managed: [{ type: "any-custom-type" }] }
}

it("generic profile makes no capability assumptions", () => {
  assert.isTrue(genericProfile.capabilities.octavia("any-region"))
  assert.isTrue(genericProfile.capabilities.floatingIps)
  assert.deepStrictEqual(genericProfile.capabilities.volumeTypes, [])
})

it.effect("generic profile accepts any region/HA/volume-type combo (no assumptions)", () =>
  Effect.gen(function*() {
    yield* genericProfile.validate(baseConfig)
  }))

// AC8: `provider: upcloud` has no bespoke profile, so it lands on `generic` —
// which used to validate nothing, letting an autoscaling config apply with the
// block silently dropped.
it.effect("generic profile rejects autoscaling on a distro that cannot do it (AC8)", () =>
  Effect.gen(function*() {
    const config: ClusterConfigShape = {
      ...baseConfig,
      distro: "upcloud-uks",
      worker_pools: [{ name: "workers", autoscaling: { enabled: true } }]
    }
    const result = yield* Effect.result(genericProfile.validate(config))
    assert.isTrue(result._tag === "Failure")
    if (result._tag === "Failure") {
      assert.include(result.failure.issues[0]?.message ?? "", "upcloud-uks")
    }
  }))
