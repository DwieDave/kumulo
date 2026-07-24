import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { computePlan, decidePlanAction, parseConfigYaml, renderPlan, toTaggedResource } from "@kumulo/core"
import type { ClusterConfig, DesiredResource, Inventory } from "@kumulo/core"

// AC-1 — `kumulo create --config examples/... --dry-run` prints a correct
// plan against a fake CloudProvider inventory. Exercises the real
// compute/render pipeline (already unit-tested per-case in
// packages/core/test/plan) end-to-end against the example config's actual
// worker pools, for empty/partial/complete/drifted inventories.
const _desiredFor = (config: ClusterConfig): ReadonlyArray<DesiredResource> =>
  config.worker_pools.flatMap((pool) =>
    Array.from({ length: pool.count }, (_, index) => ({
      cluster: config.name,
      role: "worker" as const,
      pool: pool.name,
      index,
      spec: { flavor: pool.flavor }
    }))
  )

const _cases = [
  { file: "ovh-mks.yaml", label: "ovh-mks" },
  { file: "k3s.yaml", label: "k3s" }
] as const

for (const { file, label } of _cases) {
  const _config = Effect.runSync(parseConfigYaml(readFileSync(join(import.meta.dirname, file), "utf8")))
  const _desired = _desiredFor(_config)

  describe(`dry-run plan against fake inventory (${label})`, () => {
    it("empty inventory -> all creates", () => {
      const plan = computePlan({ desired: _desired, actual: [] })
      expect(decidePlanAction({ plan, yes: false, dryRun: true })).toEqual({ _tag: "DryRun" })
      expect(renderPlan(plan)).toMatchSnapshot()
    })

    it("partial inventory -> mix of no-op and create", () => {
      const actual: Inventory = _desired.slice(0, 1).map(toTaggedResource)
      const plan = computePlan({ desired: _desired, actual })
      expect(renderPlan(plan)).toMatchSnapshot()
    })

    it("complete matching inventory -> all no-ops, nothing to do", () => {
      const actual: Inventory = _desired.map(toTaggedResource)
      const plan = computePlan({ desired: _desired, actual })
      expect(decidePlanAction({ plan, yes: false, dryRun: false })).toEqual({ _tag: "NothingToDo" })
      expect(renderPlan(plan)).toMatchSnapshot()
    })

    it("drifted inventory -> replace-needs-confirm, never a silent apply", () => {
      const actual: Inventory = _desired.map((resource) => toTaggedResource({ ...resource, spec: { flavor: "drifted" } }))
      const plan = computePlan({ desired: _desired, actual })
      expect(decidePlanAction({ plan, yes: false, dryRun: false })).toEqual({ _tag: "NeedsConfirm" })
      expect(renderPlan(plan)).toMatchSnapshot()
    })
  })
}
