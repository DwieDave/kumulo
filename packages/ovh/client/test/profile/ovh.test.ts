import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import type { ClusterConfigFields } from "@kumulo/core"
import { makeOvhProfile } from "../../src/profile/ovh.ts"
import { hasOctavia } from "../../src/profile/regions.ts"

const baseConfig: ClusterConfigFields = {
  distro: "k3s",
  worker_pools: [],
  addons: { cni: "flannel" },
  auth: { region: "GRA5" },
  api_server: { high_availability: true },
  volumes: { managed: [{ type: "classic" }] }
}

it("octavia regions are known", () => {
  assert.isTrue(hasOctavia("GRA5"))
  assert.isFalse(hasOctavia("some-unknown-region"))
})

it.effect("accepts a valid HA config in an Octavia region with an OVH volume type", () =>
  Effect.gen(function*() {
    const profile = makeOvhProfile("GRA5")
    yield* profile.validate(baseConfig)
  }))

it.effect("rejects HA control plane in a region without Octavia", () =>
  Effect.gen(function*() {
    const profile = makeOvhProfile("BHS1")
    const result = yield* Effect.flip(profile.validate({ ...baseConfig, auth: { region: "BHS1" } }))
    assert.strictEqual(result._tag, "ConfigInvalid")
    assert.isTrue(result.issues.some((issue) => issue.message.includes("Octavia")))
  }))

it.effect("rejects an unsupported volume type", () =>
  Effect.gen(function*() {
    const profile = makeOvhProfile("GRA5")
    const config = { ...baseConfig, volumes: { managed: [{ type: "ssd-nvme" }] } }
    const result = yield* Effect.flip(profile.validate(config))
    assert.isTrue(result.issues.some((issue) => issue.message.includes("ssd-nvme")))
  }))

it.effect("rejects cilium under ovh-mks (cross-distro rule reused)", () =>
  Effect.gen(function*() {
    const profile = makeOvhProfile("GRA5")

    const config: ClusterConfigFields = {
      ...baseConfig,
      distro: "ovh-mks",
      api_server: { high_availability: false },
      addons: { cni: "cilium" }
    }

    const result = yield* Effect.flip(profile.validate(config))
    assert.isTrue(result.issues.some((issue) => issue.message.includes("cilium")))
  }))
