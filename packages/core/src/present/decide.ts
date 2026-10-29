import { Data } from "effect"
import { PlanAction, type Plan } from "../plan/types.ts"

// Pure confirm/--yes/--dry-run decision — the CLI boundary interprets this
// to prompt, print, or proceed.
export type PlanDecision = Data.TaggedEnum<{
  DryRun: {}
  NothingToDo: {}
  Proceed: {}
  NeedsConfirm: {}
}>

export const PlanDecision = Data.taggedEnum<PlanDecision>()

export const decidePlanAction = (
  { plan, yes, dryRun }: { readonly plan: Plan; readonly yes: boolean; readonly dryRun: boolean }
): PlanDecision => {
  if (dryRun) return PlanDecision.DryRun()

  if (plan.actions.every(PlanAction.$is("NoOp"))) return PlanDecision.NothingToDo()

  if (yes) return PlanDecision.Proceed()

  return PlanDecision.NeedsConfirm()
}
