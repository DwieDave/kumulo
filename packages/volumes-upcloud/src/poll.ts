import { Effect, Ref, Schedule } from "effect"
import type { Duration } from "effect"

export interface StatusPollOptions<Status, E> {
  readonly check: Effect.Effect<Status, E>
  readonly isDone: (status: Status) => boolean
  readonly interval: Duration.Input
  readonly timeout: Duration.Input
  /** Builds the failure raised when `timeout` elapses before `isDone`, given the last observed status (if any). */
  readonly onTimeout: (lastStatus: Status | undefined) => E
}

/**
 * Polls an async provisioning state until `isDone` or `timeout` (R4).
 *
 * kumulo: local re-implementation of core's `reconcile/poll.ts` `pollUntil`
 * — not re-exported from `@kumulo/core`'s package root, and dep-lint's
 * `no-deep-package-imports` rule forbids reaching into core's `src`
 * internals. Mirrors `distro-upcloud-uks/src/distro/status.ts`, but the
 * `VolumeProvider` port's `VolumeError` union has no `ProvisioningTimeout`
 * member (unlike `MksError`), so the timeout failure is caller-supplied
 * instead of a fixed tagged error. Small enough to duplicate.
 */
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
