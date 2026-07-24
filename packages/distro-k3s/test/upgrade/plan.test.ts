import { assert, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import type { K8sManifest } from "@kumulo/core"
import { refForPlan, renderMastersPlan, renderUpgradePlan, renderWorkersPlan } from "../../src/upgrade/plan.ts"

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

it("refForPlan derives the plan path from metadata name/namespace", () => {
  assert.deepStrictEqual(
    refForPlan(renderMastersPlan(VERSION)),
    { path: "/apis/upgrade.cattle.io/v1/namespaces/system-upgrade/plans/k3s-server", kind: "Plan" }
  )
})

it("refForPlan falls back to the system-upgrade namespace and empty name when metadata fails to decode", () => {
  const manifest: K8sManifest = { apiVersion: "upgrade.cattle.io/v1", kind: "Plan", metadata: null }
  assert.deepStrictEqual(
    refForPlan(manifest),
    { path: "/apis/upgrade.cattle.io/v1/namespaces/system-upgrade/plans/", kind: "Plan" }
  )
})
