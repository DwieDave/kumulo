import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { renderPlan } from "../../src/present/render.ts"
import type { Plan, PlanAction } from "../../src/plan/types.ts"

describe("renderPlan", () => {
  it("renders a mixed plan terraform-plan-style, grouped with a summary count", () => {
    const plan: Plan = {
      actions: [
        { _tag: "NoOp", name: "kumulo-prod-worker-default-0" },
        { _tag: "Create", name: "kumulo-prod-worker-default-1" },
        { _tag: "Delete", name: "kumulo-prod-old-default-0" },
        {
          _tag: "ReplaceNeedsConfirm",
          name: "kumulo-prod-master-default-0",
          reason: "config-hash drifted from desired spec"
        }
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

  const _actionArb: fc.Arbitrary<PlanAction> = fc.oneof(
    fc.record({ _tag: fc.constant("Create" as const), name: fc.string() }),
    fc.record({ _tag: fc.constant("Delete" as const), name: fc.string() }),
    fc.record({ _tag: fc.constant("NoOp" as const), name: fc.string() }),
    fc.record({ _tag: fc.constant("ReplaceNeedsConfirm" as const), name: fc.string(), reason: fc.string() })
  )

  it.prop(
    "every plan item is rendered exactly once",
    [fc.array(_actionArb, { maxLength: 20 })],
    ([actions]) => {
      const rendered = renderPlan({ actions })
      return actions.every((action) => rendered.includes(action.name))
        && rendered.split("\n").filter((line) => line.startsWith("  ")).length === actions.length
    }
  )
})
