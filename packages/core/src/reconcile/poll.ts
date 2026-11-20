import { Effect, Predicate, Ref, Schedule } from "effect"
import type { Duration } from "effect"
import { ProviderApiError, ProvisioningTimeout } from "../errors/tagged.ts"

export interface PollOptions<Status, E, R, Timeout = ProvisioningTimeout> {
  readonly check: Effect.Effect<Status, E, R>
  readonly isDone: (status: Status) => boolean
  readonly interval: Duration.Input
  readonly timeout: Duration.Input
  readonly kind: string
  readonly ref: string
  readonly describe?: (status: Status) => string
  // number of ResourceNotFound results treated as "not ready yet" before the error propagates
  readonly tolerateNotFound?: number
  // a status matching this fails fast with ProviderApiError instead of polling to the timeout
  readonly isFailed?: (status: Status) => boolean
  // replaces the default ProvisioningTimeout
  readonly onTimeout?: (lastStatus: Status | undefined) => Timeout
}

// String(object) is "[object Object]", JSON.stringify is the least-wrong default
const _describe = <Status>(status: Status): string => Predicate.isObjectOrArray(status) ? JSON.stringify(status) : String(status)

interface PollFailFast<Status> {
  readonly isFailed: (status: Status) => boolean
}

export function pollUntil<Status, E, R, Timeout = ProvisioningTimeout>(
  options: PollOptions<Status, E, R, Timeout> & PollFailFast<Status>
): Effect.Effect<Status, E | Timeout | ProviderApiError, R>
export function pollUntil<Status, E, R, Timeout = ProvisioningTimeout>(
  options: PollOptions<Status, E, R, Timeout> & { readonly isFailed?: undefined }
): Effect.Effect<Status, E | Timeout, R>
export function pollUntil<Status, E, R>(
  options: PollOptions<Status, E, R, unknown>
): Effect.Effect<Status, unknown, R> {
  return _poll(options)
}

const _poll = <Status, E, R>(
  options: PollOptions<Status, E, R, unknown>
): Effect.Effect<Status, unknown, R> =>
  Effect.gen(function*() {
    const last = yield* Ref.make<Status | undefined>(undefined)
    const tolerated = yield* Ref.make(0)
    const allowed = options.tolerateNotFound ?? 0

    const failFast = (status: Status): Effect.Effect<void, ProviderApiError> =>
      options.isFailed?.(status) === true
        ? Effect.fail(
          new ProviderApiError({ operation: `${options.kind} ${options.ref}`, status: 0, body: `entered state "failed"` })
        )
        : Effect.void

    // a tolerated not-found yields undefined: not ready, keep polling
    const checked: Effect.Effect<Status | undefined, E, R> = allowed === 0
      ? options.check
      : options.check.pipe(
        Effect.catchIf(
          (error): error is Extract<E, { readonly _tag: "ResourceNotFound" }> =>
            Predicate.isTagged(error, "ResourceNotFound"),
          (error) =>
            Ref.modify(tolerated, (count): [boolean, number] => [count < allowed, count + 1]).pipe(
              Effect.flatMap((skip): Effect.Effect<undefined, E> => (skip ? Effect.succeed(undefined) : Effect.fail(error)))
            )
        )
      )

    const polled = checked.pipe(
      Effect.tap((status) =>
        status === undefined ? Effect.void : Ref.set(last, status).pipe(Effect.andThen(failFast(status)))
      ),
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
                options.onTimeout
                  ? options.onTimeout(status)
                  : new ProvisioningTimeout({
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
