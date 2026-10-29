import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { renderPlan } from "../../src/present/render.ts"
import { PlanAction } from "../../src/plan/types.ts"
import type { Plan } from "../../src/plan/types.ts"

describe("renderPlan", () => {
  it("renders a mixed plan terraform-plan-style, grouped with a summary count", () => {
    const plan: Plan = {
      actions: [
        PlanAction.NoOp({ name: "kumulo-prod-worker-default-0" }),
        PlanAction.Create({ name: "kumulo-prod-worker-default-1" }),
        PlanAction.Delete({ name: "kumulo-prod-old-default-0" }),
        PlanAction.ReplaceNeedsConfirm({
          name: "kumulo-prod-master-default-0",
          reason: "config-hash drifted from desired spec"
        })
      ]
    }

    expect(renderPlan(plan)).toMatchInlineSnapshot(`
      "Plan: 1 to create, 1 to delete, 0 to update, 1 to replace, 1 unchanged.

        + kumulo-prod-worker-default-1
        -/+ kumulo-prod-master-default-0 (config-hash drifted from desired spec)
        - kumulo-prod-old-default-0
        = kumulo-prod-worker-default-0"
    `)
  })

  it("empty plan renders an all-zero summary and no lines", () => {
    expect(renderPlan({ actions: [] })).toBe("Plan: 0 to create, 0 to delete, 0 to update, 0 to replace, 0 unchanged.")
  })

  const _rowSchema = Schema.Struct({
    tag: Schema.Literals(["Create", "Delete", "NoOp", "ReplaceNeedsConfirm"]),
    name: Schema.String,
    reason: Schema.String
  })

  it.prop(
    "every plan item is rendered exactly once",
    [Schema.Array(_rowSchema).check(Schema.isMaxLength(20))],
    ([rows]) => {
      const actions = rows.map((row) =>
        row.tag === "ReplaceNeedsConfirm"
          ? PlanAction.ReplaceNeedsConfirm({ name: row.name, reason: row.reason })
          : PlanAction[row.tag]({ name: row.name })
      )

      const rendered = renderPlan({ actions })

      return actions.every((action) => rendered.includes(action.name))
        && rendered.split("\n").filter((line) => line.startsWith("  ")).length === actions.length
    }
  )
})
