import { Effect, Ref, Schedule } from "effect"
import type { Duration } from "effect"
import { ProvisioningTimeout } from "@kumulo/core"
import type { MksError } from "@kumulo/core"

export interface StatusPollOptions<Status> {
  readonly check: Effect.Effect<Status, MksError>
  readonly isDone: (status: Status) => boolean
  readonly interval: Duration.Input
  readonly timeout: Duration.Input
  readonly ref: string
}

// Local re-implementation of core's pollUntil: dep-lint forbids reaching into core's src internals from a sibling package.
export const pollUntil = <Status>(options: StatusPollOptions<Status>): Effect.Effect<Status, MksError> =>
  Effect.gen(function*() {
    const last = yield* Ref.make<Status | undefined>(undefined)
    const polled = options.check.pipe(
      Effect.tap((status) => Ref.set(last, status)),
      Effect.repeat({ until: options.isDone, schedule: Schedule.spaced(options.interval) })
    )
    return yield* polled.pipe(
      Effect.timeoutOrElse({
        duration: options.timeout,
        orElse: () =>
          Ref.get(last).pipe(
            Effect.flatMap((status) =>
              Effect.fail(
                new ProvisioningTimeout({
                  kind: "mks-cluster",
                  ref: options.ref,
                  lastStatus: status === undefined ? "unknown" : String(status)
                })
              )
            )
          )
      })
    )
  })
