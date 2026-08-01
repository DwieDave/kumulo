import type { ResourceCoordinates } from "./naming.ts"

export interface DesiredResource extends ResourceCoordinates {
  readonly spec: unknown
}

// configHash absent means "can't tell drift", not "drifted"
export interface TaggedResource {
  readonly name: string
  readonly configHash?: string | undefined
}

export type PlanAction =
  | { readonly _tag: "Create"; readonly name: string }
  | { readonly _tag: "Delete"; readonly name: string }
  | { readonly _tag: "NoOp"; readonly name: string }
  | { readonly _tag: "Update"; readonly name: string; readonly reason: string }
  | { readonly _tag: "ReplaceNeedsConfirm"; readonly name: string; readonly reason: string }

export interface Plan {
  readonly actions: ReadonlyArray<PlanAction>
}
