import type { Plan, PlanAction } from "@kumulo/core"

/**
 * ponytail: `@kumulo/core`'s `present/decide.ts` + `present/render.ts` already
 * implement exactly this (pure, already unit-tested) — but they aren't
 * re-exported through `core/src/index.ts` yet, and that barrel is owned by
 * the integration step (out of scope here), so reaching them isn't possible
 * without a deep import (banned by dep-cruiser). Duplicated verbatim; delete
 * this file and import from `@kumulo/core` once the barrel picks them up.
 */
export type PlanDecision =
  | { readonly _tag: "DryRun" }
  | { readonly _tag: "NothingToDo" }
  | { readonly _tag: "Proceed" }
  | { readonly _tag: "NeedsConfirm" }

export const decidePlanAction = (
  { plan, yes, dryRun }: { readonly plan: Plan; readonly yes: boolean; readonly dryRun: boolean }
): PlanDecision => {
  if (dryRun) return { _tag: "DryRun" }
  if (plan.actions.every((action) => action._tag === "NoOp")) return { _tag: "NothingToDo" }
  if (yes) return { _tag: "Proceed" }
  return { _tag: "NeedsConfirm" }
}

const _renderLine = (action: PlanAction): string => {
  if (action._tag === "Create") return `  + ${action.name}`
  if (action._tag === "Delete") return `  - ${action.name}`
  if (action._tag === "NoOp") return `  = ${action.name}`
  return `  ~ ${action.name} (${action.reason})`
}

const _count = (actions: ReadonlyArray<PlanAction>, tag: PlanAction["_tag"]): number =>
  actions.filter((action) => action._tag === tag).length

const _groupOrder: ReadonlyArray<PlanAction["_tag"]> = ["Create", "ReplaceNeedsConfirm", "Delete", "NoOp"]

export const renderPlan = (plan: Plan): string => {
  const summary = `Plan: ${_count(plan.actions, "Create")} to create, ${
    _count(plan.actions, "Delete")
  } to delete, ${_count(plan.actions, "ReplaceNeedsConfirm")} to replace, ${
    _count(plan.actions, "NoOp")
  } unchanged.`
  if (plan.actions.length === 0) return summary
  const grouped = _groupOrder.flatMap((tag) => plan.actions.filter((action) => action._tag === tag))
  return [summary, "", ...grouped.map(_renderLine)].join("\n")
}
