import { Effect } from "effect"
import { DriftDetected } from "./errors.ts"

const _firstDiffLine = (args: { readonly a: string; readonly b: string }): number => {
  const linesA = args.a.split("\n")
  const linesB = args.b.split("\n")
  const length = Math.max(linesA.length, linesB.length)
  for (let i = 0; i < length; i++) {
    if (linesA[i] !== linesB[i]) return i + 1
  }
  return length + 1
}

/**
 * Stage 4: regen-is-noop check — compares freshly regenerated source against
 * the committed file. Nonzero (a `DriftDetected` failure) on any difference.
 */
export const checkNoop = (args: {
  readonly committedPath: string
  readonly committed: string
  readonly regenerated: string
}): Effect.Effect<void, DriftDetected> =>
  args.committed === args.regenerated
    ? Effect.void
    : Effect.fail(
        new DriftDetected({
          committedPath: args.committedPath,
          firstDiffLine: _firstDiffLine({ a: args.committed, b: args.regenerated })
        })
      )
