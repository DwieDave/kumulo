import type { Plan, PlanAction } from "@kumulo/core"

// The decision (dry-run/nothing-to-do/confirm) is pure domain and lives in
// core; only the ANSI rendering below is CLI-specific.
export { decidePlanAction } from "@kumulo/core"
export type { PlanDecision } from "@kumulo/core"

// ANSI colors only when writing to a real terminal — piped/captured output
// (tests, files) stays plain.
const _color = (code: number) => (text: string): string =>
  process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text

export const green = _color(32)
export const red = _color(31)
export const yellow = _color(33)
export const dim = _color(2)

/** One plan row without the two-space indent — the live view puts its spinner/check there instead. */
export const renderActionLine = (action: PlanAction): string => {
  if (action._tag === "Create") return green(`+ ${action.name}`)
  if (action._tag === "Delete") return red(`- ${action.name}`)
  if (action._tag === "NoOp") return dim(`= ${action.name}`)
  if (action._tag === "Update") return yellow(`~ ${action.name} (${action.reason})`)
  return yellow(`-/+ ${action.name} (${action.reason})`)
}

const _renderLine = (action: PlanAction): string => `  ${renderActionLine(action)}`

const _count = (actions: ReadonlyArray<PlanAction>, tag: PlanAction["_tag"]): number =>
  actions.filter((action) => action._tag === tag).length

const _groupOrder: ReadonlyArray<PlanAction["_tag"]> = ["Create", "Update", "ReplaceNeedsConfirm", "Delete", "NoOp"]

/** Plan actions in display order (Create, Update, Replace, Delete, NoOp) — matches `renderPlan`'s row order. */
export const orderedActions = (plan: Plan): ReadonlyArray<PlanAction> =>
  _groupOrder.flatMap((tag) => plan.actions.filter((action) => action._tag === tag))

export const renderPlan = (plan: Plan): string => {
  const summary = `Plan: ${green(`${_count(plan.actions, "Create")} to create`)}, ${
    red(`${_count(plan.actions, "Delete")} to delete`)
  }, ${yellow(`${_count(plan.actions, "Update")} to update`)}, ${
    yellow(`${_count(plan.actions, "ReplaceNeedsConfirm")} to replace`)
  }, ${dim(`${_count(plan.actions, "NoOp")} unchanged`)}.`
  if (plan.actions.length === 0) return summary
  return [summary, "", ...orderedActions(plan).map(_renderLine)].join("\n")
}
