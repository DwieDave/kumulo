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
  volumes: { retained: [{ type: "any-custom-type" }] }
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
