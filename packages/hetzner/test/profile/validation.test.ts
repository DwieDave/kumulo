import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import type { ClusterConfigShape } from "@kumulo/core"
import { validateHetznerConfig } from "../../src/profile/validation.ts"

const _config = (region: string): ClusterConfigShape => ({
  distro: "k3s",
  worker_pools: [],
  addons: { cni: "flannel" },
  auth: { region }
})

it.effect("accepts every one of the 6 known Hetzner locations", () =>
  Effect.gen(function*() {
    for (const location of ["fsn1", "nbg1", "hel1", "ash", "hil", "sin"]) {
      const result = yield* Effect.result(validateHetznerConfig(_config(location)))
      assert.strictEqual(result._tag, "Success")
    }
  }))

it.effect("rejects an unrecognized location", () =>
  Effect.gen(function*() {
    const result = yield* Effect.result(validateHetznerConfig(_config("gra")))
    assert.strictEqual(result._tag, "Failure")
  }))

it.effect("still runs the shared cross-distro rules (autoscaling/cni)", () =>
  Effect.gen(function*() {
    const config: ClusterConfigShape = {
      distro: "k3s",
      worker_pools: [{ name: "pool-1", autoscaling: { enabled: true } }],
      addons: { cni: "flannel" },
      auth: { region: "fsn1" }
    }
    const result = yield* Effect.result(validateHetznerConfig(config))
    assert.strictEqual(result._tag, "Failure")
  }))
