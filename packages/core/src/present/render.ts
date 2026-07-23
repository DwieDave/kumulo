import type { Plan, PlanAction } from "../plan/types.ts"

// Terraform-plan-style, one line per action — design §6 step 3 "Present".
const _renderLine = (action: PlanAction): string => {
  if (action._tag === "Create") return `  + ${action.name}`
  if (action._tag === "Delete") return `  - ${action.name}`
  if (action._tag === "NoOp") return `  = ${action.name}`
  return `  ~ ${action.name} (${action.reason})`
}

const _count = (actions: ReadonlyArray<PlanAction>, tag: PlanAction["_tag"]): number =>
  actions.filter((action) => action._tag === tag).length

// Grouping order mirrors `terraform plan`: additions, then changes, then
// removals, unchanged resources last.
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
