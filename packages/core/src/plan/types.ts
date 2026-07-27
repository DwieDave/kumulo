import type { ResourceCoordinates } from "./naming.ts"

// What the config asks for: where the resource lives plus the opaque
// provider spec that gets hashed for drift detection.
export interface DesiredResource extends ResourceCoordinates {
  readonly spec: unknown
}

// What the inventory reports back: identity plus the hash of the spec
// it was created from. `configHash` is optional because not every provider
// stores it on the resource — unknown means "can't tell drift", not "drifted".
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
