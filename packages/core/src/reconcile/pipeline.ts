import { Effect } from "effect"

export interface Phase<Name extends string, E, R> {
  readonly name: Name
  readonly run: Effect.Effect<void, E, R>
}

// The order is the dependency graph; phases nobody supplied are simply
// absent (a managed cluster has no "Network" step) and never fabricated.
export const runPhases = <Name extends string, E, R>(
  { order, phases }: { readonly order: ReadonlyArray<Name>; readonly phases: ReadonlyArray<Phase<Name, E, R>> }
): Effect.Effect<void, E, R> =>
  Effect.forEach(
    order.flatMap((name) => phases.filter((phase) => phase.name === name)),
    (phase) => phase.run,
    { discard: true }
  )
