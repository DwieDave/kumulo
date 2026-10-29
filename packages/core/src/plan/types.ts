import { Data } from "effect"
import type { ResourceCoordinates } from "./naming.ts"

export interface DesiredResource extends ResourceCoordinates {
  readonly spec: unknown
}

// configHash absent means "can't tell drift", not "drifted"
export interface TaggedResource {
  readonly name: string
  readonly configHash?: string | undefined
}

export type PlanAction = Data.TaggedEnum<{
  Create: { readonly name: string }
  Delete: { readonly name: string }
  NoOp: { readonly name: string }
  Update: { readonly name: string; readonly reason: string }
  ReplaceNeedsConfirm: { readonly name: string; readonly reason: string }
}>

export const PlanAction = Data.taggedEnum<PlanAction>()

export interface Plan {
  readonly actions: ReadonlyArray<PlanAction>
}
