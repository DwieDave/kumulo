import { describe, expect, it } from "@effect/vitest"
import { decidePlanAction, PlanDecision } from "../../src/present/decide.ts"
import { PlanAction, type Plan } from "../../src/plan/types.ts"

const _plan = (actions: Plan["actions"]): Plan => ({ actions })

describe("decidePlanAction", () => {
  it("dry-run always short-circuits, even with pending changes", () => {
    const plan = _plan([PlanAction.Create({ name: "a" })])
    expect(decidePlanAction({ plan, yes: true, dryRun: true })).toEqual(PlanDecision.DryRun())
  })

  it("an all no-op plan needs no confirmation", () => {
    const plan = _plan([PlanAction.NoOp({ name: "a" })])
    expect(decidePlanAction({ plan, yes: false, dryRun: false })).toEqual(PlanDecision.NothingToDo())
  })

  it("--yes proceeds without asking", () => {
    const plan = _plan([PlanAction.Create({ name: "a" })])
    expect(decidePlanAction({ plan, yes: true, dryRun: false })).toEqual(PlanDecision.Proceed())
  })

  it("pending changes without --yes need interactive confirmation", () => {
    const plan = _plan([PlanAction.Create({ name: "a" })])
    expect(decidePlanAction({ plan, yes: false, dryRun: false })).toEqual(PlanDecision.NeedsConfirm())
  })

  it("an empty plan is nothing to do", () => {
    expect(decidePlanAction({ plan: _plan([]), yes: false, dryRun: false })).toEqual(PlanDecision.NothingToDo())
  })
})
