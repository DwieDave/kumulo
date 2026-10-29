import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { computePlan, toTaggedResource } from "../../src/plan/diff.ts"
import { PlanAction } from "../../src/plan/types.ts"
import type { DesiredResource } from "../../src/plan/types.ts"

const _desiredResource = (overrides: Partial<DesiredResource> = {}): DesiredResource => ({
  cluster: "prod",
  role: "worker",
  pool: "default",
  index: 0,
  spec: { flavor: "b2-7", image: "ubuntu-24.04" },
  ...overrides
})

describe("computePlan", () => {
  it("empty inventory -> all creates", () => {
    const plan = computePlan({ desired: [_desiredResource()], actual: [] })
    expect(plan.actions).toEqual([PlanAction.Create({ name: "kumulo-prod-worker-default-0" })])
  })

  it("empty desired against a non-empty inventory -> all deletes", () => {
    const actual = [toTaggedResource(_desiredResource())]
    const plan = computePlan({ desired: [], actual })
    expect(plan.actions).toEqual([PlanAction.Delete({ name: "kumulo-prod-worker-default-0" })])
  })

  it("partial overlap -> create for the missing one, no-op for the matching one", () => {
    const existing = _desiredResource({ index: 0 })
    const missing = _desiredResource({ index: 1 })
    const actual = [toTaggedResource(existing)]
    const plan = computePlan({ desired: [existing, missing], actual })
    expect(plan.actions).toEqual([
      PlanAction.NoOp({ name: "kumulo-prod-worker-default-0" }),
      PlanAction.Create({ name: "kumulo-prod-worker-default-1" })
    ])
  })

  it("complete match with identical specs -> all no-ops", () => {
    const desired = [_desiredResource({ index: 0 }), _desiredResource({ index: 1 })]
    const actual = desired.map(toTaggedResource)
    const plan = computePlan({ desired, actual })
    expect(plan.actions.every(PlanAction.$is("NoOp"))).toBe(true)
  })

  it("observed resource without a config hash -> no-op, not a phantom replace", () => {
    const desired = _desiredResource()
    const plan = computePlan({ desired: [desired], actual: [{ name: "kumulo-prod-worker-default-0" }] })
    expect(plan.actions).toEqual([PlanAction.NoOp({ name: "kumulo-prod-worker-default-0" })])
  })

  it("drifted spec -> replace-needs-confirm, never a silent apply", () => {
    const original = _desiredResource()
    const actual = [toTaggedResource(original)]
    const drifted = _desiredResource({ spec: { flavor: "b2-15", image: "ubuntu-24.04" } })
    const plan = computePlan({ desired: [drifted], actual })
    expect(plan.actions).toEqual([
      PlanAction.ReplaceNeedsConfirm({
        name: "kumulo-prod-worker-default-0",
        reason: "config-hash drifted from desired spec"
      })
    ])
  })

  it.prop(
    "plan-after-apply converges to all no-ops",
    [Schema.Array(Schema.Struct({ flavor: Schema.String, image: Schema.String })).check(Schema.isMaxLength(8))],
    ([rows]) => {
      const desired = rows.map((row, index) =>
        _desiredResource({ index, spec: { flavor: row.flavor, image: row.image } })
      )

      const inventoryAfterApply = desired.map(toTaggedResource)
      const plan = computePlan({ desired, actual: inventoryAfterApply })

      return plan.actions.every(PlanAction.$is("NoOp"))
    }
  )
})
