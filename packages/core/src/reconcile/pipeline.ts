import { Effect } from "effect"
import type { PhaseName } from "./phases.ts"

// Named, orderable unit of the reconcile pipeline. `run` is provided by the
// caller (concrete phase implementations arrive with later milestones); this
// module only owns sequencing.
export interface Phase<E = never, R = never> {
  readonly name: PhaseName
  readonly run: Effect.Effect<void, E, R>
}

// Runs phases strictly in the given dependency order (FR-2.3), short-
// circuiting on the first failure. Phases the caller didn't supply for this
// order are silently skipped — a milestone may only implement a subset.
export const runPhases = <E, R>(
  { order, phases }: { readonly order: ReadonlyArray<PhaseName>; readonly phases: ReadonlyArray<Phase<E, R>> }
): Effect.Effect<void, E, R> => {
  const byName = new Map(phases.map((phase) => [phase.name, phase]))
  const ordered = order.flatMap((name) => {
    const phase = byName.get(name)
    return phase === undefined ? [] : [phase]
  })
  return Effect.forEach(ordered, (phase) => phase.run, { discard: true })
}
