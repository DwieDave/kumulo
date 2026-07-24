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

/**
 * Polls async cluster/nodepool provisioning statuses until `isDone` or
 * `timeout` (surfaced as `ProvisioningTimeout`).
 *
 * kumulo: a local re-implementation of core's `reconcile/poll.ts`
 * `pollUntil` — that helper isn't re-exported from `@kumulo/core`'s package
 * root, and dep-lint's `no-deep-package-imports` rule forbids reaching into
 * core's `src` internals from a sibling package. Small enough to duplicate.
 */
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
