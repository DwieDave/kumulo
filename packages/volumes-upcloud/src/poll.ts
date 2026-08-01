import { Effect, Ref, Schedule } from "effect"
import type { Duration } from "effect"

export interface StatusPollOptions<Status, E> {
  readonly check: Effect.Effect<Status, E>
  readonly isDone: (status: Status) => boolean
  readonly interval: Duration.Input
  readonly timeout: Duration.Input
  readonly onTimeout: (lastStatus: Status | undefined) => E
}

// kumulo: local dup of core's pollUntil — no-deep-package-imports forbids reaching into core's src internals
export const pollUntil = <Status, E>(options: StatusPollOptions<Status, E>): Effect.Effect<Status, E> =>
  Effect.gen(function*() {
    const last = yield* Ref.make<Status | undefined>(undefined)
    const polled = options.check.pipe(
      Effect.tap((status) => Ref.set(last, status)),
      Effect.repeat({ until: options.isDone, schedule: Schedule.spaced(options.interval) })
    )
    return yield* polled.pipe(
      Effect.timeoutOrElse({
        duration: options.timeout,
        orElse: () => Ref.get(last).pipe(Effect.flatMap((status) => Effect.fail(options.onTimeout(status))))
      })
    )
  })
