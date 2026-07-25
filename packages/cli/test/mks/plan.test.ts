import { assert, it } from "@effect/vitest"
import { buildMksPlan, emptyMksInventory, type MksInventory, type MksPlanInput } from "../../src/mks/plan.ts"

const _config: MksPlanInput = {
  name: "prod-eu",
  worker_pools: [{ name: "workers" }, { name: "gpu" }],
  volumes: { module: "none" }
}

it("one Create action per cluster plus one per worker pool on empty inventory", () => {
  const plan = buildMksPlan({ config: _config, inventory: emptyMksInventory })
  assert.deepStrictEqual(plan.actions, [
    { _tag: "Create", name: "mks-cluster/prod-eu" },
    { _tag: "Create", name: "mks-pool/prod-eu/workers" },
    { _tag: "Create", name: "mks-pool/prod-eu/gpu" }
  ])
})

it("adds a Create action per managed volume when volumes.module is cinder", () => {
  const plan = buildMksPlan({
    config: { ..._config, volumes: { module: "cinder", managed: [{ name: "data" }, { name: "logs" }] } },
    inventory: emptyMksInventory
  })
  assert.deepStrictEqual(plan.actions, [
    { _tag: "Create", name: "mks-cluster/prod-eu" },
    { _tag: "Create", name: "mks-pool/prod-eu/workers" },
    { _tag: "Create", name: "mks-pool/prod-eu/gpu" },
    { _tag: "Create", name: "volume/data" },
    { _tag: "Create", name: "volume/logs" }
  ])
})

it("shows no volume actions when volumes.module isn't cinder, even with managed entries present", () => {
  const plan = buildMksPlan({
    config: { ..._config, volumes: { module: "hcloud", managed: [{ name: "data" }] } },
    inventory: emptyMksInventory
  })
  assert.deepStrictEqual(plan.actions, [
    { _tag: "Create", name: "mks-cluster/prod-eu" },
    { _tag: "Create", name: "mks-pool/prod-eu/workers" },
    { _tag: "Create", name: "mks-pool/prod-eu/gpu" }
  ])
})

it("existing resources plan as NoOp; missing ones as Create", () => {
  const inventory: MksInventory = {
    clusterExists: true,
    poolNames: new Set(["workers"]),
    volumeNames: new Set(["data"])
  }
  const plan = buildMksPlan({
    config: { ..._config, volumes: { module: "cinder", managed: [{ name: "data" }, { name: "logs" }] } },
    inventory
  })
  assert.deepStrictEqual(plan.actions, [
    { _tag: "NoOp", name: "mks-cluster/prod-eu" },
    { _tag: "NoOp", name: "mks-pool/prod-eu/workers" },
    { _tag: "Create", name: "mks-pool/prod-eu/gpu" },
    { _tag: "NoOp", name: "volume/data" },
    { _tag: "Create", name: "volume/logs" }
  ])
})

it("pools never plan as NoOp when the cluster itself is missing", () => {
  const plan = buildMksPlan({ config: _config, inventory: { clusterExists: false, poolNames: new Set(["workers", "gpu"]), volumeNames: new Set() } })
  assert.deepStrictEqual(plan.actions.map((a) => a._tag), ["Create", "Create", "Create"])
})
