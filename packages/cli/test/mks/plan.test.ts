import { assert, it } from "@effect/vitest"
import { buildMksPlan, type MksPlanInput } from "../../src/mks/plan.ts"

const _config: MksPlanInput = {
  name: "prod-eu",
  worker_pools: [{ name: "workers" }, { name: "gpu" }],
  volumes: { module: "none", managed: [] }
}

it("one Create action per cluster plus one per worker pool", () => {
  const plan = buildMksPlan(_config)
  assert.deepStrictEqual(plan.actions, [
    { _tag: "Create", name: "mks-cluster/prod-eu" },
    { _tag: "Create", name: "mks-pool/prod-eu/workers" },
    { _tag: "Create", name: "mks-pool/prod-eu/gpu" }
  ])
})

it("adds a Create action per managed volume when volumes.module is cinder", () => {
  const plan = buildMksPlan({
    ..._config,
    volumes: { module: "cinder", managed: [{ name: "data" }, { name: "logs" }] }
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
  const plan = buildMksPlan({ ..._config, volumes: { module: "none", managed: [{ name: "data" }] } })
  assert.deepStrictEqual(plan.actions, [
    { _tag: "Create", name: "mks-cluster/prod-eu" },
    { _tag: "Create", name: "mks-pool/prod-eu/workers" },
    { _tag: "Create", name: "mks-pool/prod-eu/gpu" }
  ])
})
