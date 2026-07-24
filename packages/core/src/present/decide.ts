import type { Plan } from "../plan/types.ts"

// Pure confirm/--yes/--dry-run decision — the CLI boundary interprets this
// to prompt, print, or proceed.
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
