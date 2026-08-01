import { Effect, Ref, Schedule } from "effect"
import type { Duration } from "effect"
import { ProvisioningTimeout } from "../errors/tagged.ts"

export interface PollOptions<Status, E, R> {
  readonly check: Effect.Effect<Status, E, R>
  readonly isDone: (status: Status) => boolean
  readonly interval: Duration.Input
  readonly timeout: Duration.Input
  readonly kind: string
  readonly ref: string
  /** Renders the last observed status for the timeout error — pass one when `Status` is an object. */
  readonly describe?: (status: Status) => string
}

// Async OpenStack/OVH provisioning statuses are polled on a fixed
// Schedule until `isDone`, bounded by `timeout`. Timing out fails with
// `ProvisioningTimeout` carrying the last observed status, never a bare
// "timed out".
// ponytail: String(object) is "[object Object]" — a timeout that hides the
// status it timed out on. JSON is the least-wrong default for objects.
const _describe = (status: unknown): string => typeof status === "object" && status !== null ? JSON.stringify(status) : String(status)

export const pollUntil = <Status, E, R>(
  options: PollOptions<Status, E, R>
): Effect.Effect<Status, E | ProvisioningTimeout, R> =>
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
                  kind: options.kind,
                  ref: options.ref,
                  lastStatus: status === undefined ? "unknown" : (options.describe ?? _describe)(status)
                })
              )
            )
          )
      })
    )
  })
