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

// ANSI colors only when writing to a real terminal — piped/captured output
// (tests, files) stays plain.
const _color = (code: number) => (text: string): string =>
  process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text

export const green = _color(32)
export const red = _color(31)
export const yellow = _color(33)
export const dim = _color(2)

const _renderLine = (action: PlanAction): string => {
  if (action._tag === "Create") return green(`  + ${action.name}`)
  if (action._tag === "Delete") return red(`  - ${action.name}`)
  if (action._tag === "NoOp") return dim(`  = ${action.name}`)
  return yellow(`  ~ ${action.name} (${action.reason})`)
}

const _count = (actions: ReadonlyArray<PlanAction>, tag: PlanAction["_tag"]): number =>
  actions.filter((action) => action._tag === tag).length

const _groupOrder: ReadonlyArray<PlanAction["_tag"]> = ["Create", "ReplaceNeedsConfirm", "Delete", "NoOp"]

export const renderPlan = (plan: Plan): string => {
  const summary = `Plan: ${green(`${_count(plan.actions, "Create")} to create`)}, ${
    red(`${_count(plan.actions, "Delete")} to delete`)
  }, ${yellow(`${_count(plan.actions, "ReplaceNeedsConfirm")} to replace`)}, ${
    dim(`${_count(plan.actions, "NoOp")} unchanged`)
  }.`
  if (plan.actions.length === 0) return summary
  const grouped = _groupOrder.flatMap((tag) => plan.actions.filter((action) => action._tag === tag))
  return [summary, "", ...grouped.map(_renderLine)].join("\n")
}
