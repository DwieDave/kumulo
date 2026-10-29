import { Effect, Ref, Schedule } from "effect"
import type { Duration } from "effect"
import { ProviderApiError, ProvisioningTimeout } from "@kumulo/core"
import type { MksError } from "@kumulo/core"

export interface StatusPollOptions<Status> {
  readonly check: Effect.Effect<Status, MksError>
  readonly isDone: (status: Status) => boolean
  readonly interval: Duration.Input
  readonly timeout: Duration.Input
  readonly kind: string
  readonly ref: string
  readonly tolerateNotFound?: number
  readonly isFailed?: (status: Status) => boolean
}

export const pollUntil = <Status>(options: StatusPollOptions<Status>): Effect.Effect<Status, MksError> =>
  Effect.gen(function*() {
    const last = yield* Ref.make<Status | undefined>(undefined)

    const tolerated = yield* Ref.make(0)
    const allowed = options.tolerateNotFound ?? 0

    const failFast = (status: Status): Effect.Effect<void, MksError> =>
      options.isFailed?.(status) === true
        ? Effect.fail(
          new ProviderApiError({ operation: `${options.kind} ${options.ref}`, status: 0, body: `entered state "failed"` })
        )
        : Effect.void

    // a tolerated 404 yields undefined: not ready, keep polling
    const checked = options.check.pipe(
      Effect.catchTag("ResourceNotFound", (error) =>
        Ref.modify(tolerated, (count): [boolean, number] => [count < allowed, count + 1]).pipe(
          Effect.flatMap((skip) => (skip ? Effect.succeed(undefined) : Effect.fail(error)))
        ))
    )

    const polled = checked.pipe(
      Effect.tap((status) => (status === undefined ? Effect.void : Ref.set(last, status).pipe(Effect.andThen(failFast(status))))),
      Effect.repeat({
        until: (status) => status !== undefined && options.isDone(status),
        schedule: Schedule.spaced(options.interval)
      }),
      Effect.flatMap((status) => (status === undefined ? Effect.never : Effect.succeed(status)))
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
                  lastStatus: status === undefined ? "unknown" : String(status)
                })
              )
            )
          )
      })
    )
  })

export const pollUntilGone = (
  options: Omit<StatusPollOptions<boolean>, "isDone" | "isFailed" | "tolerateNotFound" | "check"> & {
    readonly check: Effect.Effect<unknown, MksError>
  }
): Effect.Effect<void, MksError> =>
  pollUntil({
    ...options,
    check: options.check.pipe(
      Effect.as(true),
      Effect.catchTag("ResourceNotFound", () => Effect.succeed(false))
    ),
    isDone: (present) => !present
  }).pipe(Effect.asVoid)
