import { describe, expect, it } from "@effect/vitest"
import { decidePlanAction } from "../../src/present/decide.ts"
import type { Plan } from "../../src/plan/types.ts"

const _plan = (actions: Plan["actions"]): Plan => ({ actions })

describe("decidePlanAction", () => {
  it("dry-run always short-circuits, even with pending changes", () => {
    const plan = _plan([{ _tag: "Create", name: "a" }])
    expect(decidePlanAction({ plan, yes: true, dryRun: true })).toEqual({ _tag: "DryRun" })
  })

  it("an all no-op plan needs no confirmation", () => {
    const plan = _plan([{ _tag: "NoOp", name: "a" }])
    expect(decidePlanAction({ plan, yes: false, dryRun: false })).toEqual({ _tag: "NothingToDo" })
  })

  it("--yes proceeds without asking", () => {
    const plan = _plan([{ _tag: "Create", name: "a" }])
    expect(decidePlanAction({ plan, yes: true, dryRun: false })).toEqual({ _tag: "Proceed" })
  })

  it("pending changes without --yes need interactive confirmation", () => {
    const plan = _plan([{ _tag: "Create", name: "a" }])
    expect(decidePlanAction({ plan, yes: false, dryRun: false })).toEqual({ _tag: "NeedsConfirm" })
  })

  it("an empty plan is nothing to do", () => {
    expect(decidePlanAction({ plan: _plan([]), yes: false, dryRun: false })).toEqual({ _tag: "NothingToDo" })
  })
})
