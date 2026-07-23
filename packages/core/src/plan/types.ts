import type { NodeRole } from "../domain/types.ts"

// A resource kumulo wants to exist, keyed by the name-convention coordinates
// (design §6/Appendix B). `spec` is whatever the owning phase/provider needs
// to create it — only its hash matters to the plan/diff domain.
export interface DesiredResource<S = unknown> {
  readonly cluster: string
  readonly role: NodeRole
  readonly pool: string
  readonly index: number
  readonly spec: S
}

// A resource discovered by tag (design §6 "Inventory" step) — provider-
// agnostic: any tagged/named resource collapses to this shape for diffing.
export interface TaggedResource {
  readonly name: string
  readonly cluster: string
  readonly role: NodeRole
  readonly pool: string
  readonly index: number
  readonly configHash: string
}

export type Inventory = ReadonlyArray<TaggedResource>

export type PlanAction =
  | { readonly _tag: "Create"; readonly name: string }
  | { readonly _tag: "Delete"; readonly name: string }
  | { readonly _tag: "NoOp"; readonly name: string }
  | { readonly _tag: "ReplaceNeedsConfirm"; readonly name: string; readonly reason: string }

export interface Plan {
  readonly actions: ReadonlyArray<PlanAction>
}
