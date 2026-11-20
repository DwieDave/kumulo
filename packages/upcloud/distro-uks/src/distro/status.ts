import { Effect } from "effect"
import type { Duration } from "effect"
import { pollUntil } from "@kumulo/core"
import type { ManagedDistroError } from "@kumulo/core"

export const pollUntilGone = (
  options: {
    readonly check: Effect.Effect<unknown, ManagedDistroError>
    readonly interval: Duration.Input
    readonly timeout: Duration.Input
    readonly kind: string
    readonly ref: string
  }
): Effect.Effect<void, ManagedDistroError> =>
  pollUntil({
    ...options,
    check: options.check.pipe(
      Effect.as(true),
      Effect.catchTag("ResourceNotFound", () => Effect.succeed(false))
    ),
    isDone: (present) => !present
  }).pipe(Effect.asVoid)
