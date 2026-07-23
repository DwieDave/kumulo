import { assert, it } from "@effect/vitest"
import { buildMksPlan, type MksPlanInput } from "../../src/mks/plan.ts"

const _config: MksPlanInput = {
  name: "prod-eu",
  worker_pools: [{ name: "workers" }, { name: "gpu" }]
}

it("one Create action per cluster plus one per worker pool", () => {
  const plan = buildMksPlan(_config)
  assert.deepStrictEqual(plan.actions, [
    { _tag: "Create", name: "mks-cluster/prod-eu" },
    { _tag: "Create", name: "mks-pool/prod-eu/workers" },
    { _tag: "Create", name: "mks-pool/prod-eu/gpu" }
  ])
})
