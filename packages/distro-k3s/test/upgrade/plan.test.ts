import { assert, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import { renderMastersPlan, renderUpgradePlan, renderWorkersPlan } from "../../src/upgrade/plan.ts"

const VERSION = "v1.31.5+k3s1"

const _golden = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"))

it("masters plan matches the golden fixture (concurrency 1, control-plane selector, cordon)", () => {
  assert.deepStrictEqual(renderMastersPlan(VERSION), _golden("masters-plan"))
})

it("workers plan matches the golden fixture (configurable concurrency, prepare waits on k3s-server)", () => {
  assert.deepStrictEqual(renderWorkersPlan({ version: VERSION, concurrency: 2 }), _golden("workers-plan"))
})

it("renderUpgradePlan lists masters before workers, defaulting worker concurrency to 1", () => {
  const plan = renderUpgradePlan({ version: VERSION })
  assert.strictEqual(plan.length, 2)
  assert.deepStrictEqual(plan[0], renderMastersPlan(VERSION))
  assert.deepStrictEqual(plan[1], renderWorkersPlan({ version: VERSION, concurrency: 1 }))
})
