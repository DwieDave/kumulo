import { PlanAction } from "./types.ts"

// absent beats retained: a retained row only makes sense for something that exists
export const deleteRow = (
  { live, name, retain }: { readonly name: string; readonly live: boolean; readonly retain: boolean }
): PlanAction =>
  !live
    ? PlanAction.NoOp({ name: `${name} (already absent)` })
    : retain
    ? PlanAction.NoOp({ name: `${name} (retained)` })
    : PlanAction.Delete({ name })

export const createOrNoOp = ({ exists, name }: { readonly exists: boolean; readonly name: string }): PlanAction =>
  exists ? PlanAction.NoOp({ name }) : PlanAction.Create({ name })
