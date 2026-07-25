import { Config, Effect, Redacted } from "effect"
import { AuthenticationFailed } from "@kumulo/core"

const _missingEnvHint = (name: string) => new AuthenticationFailed({ hint: `missing required env var ${name}` })

/** Reads a required env var via `Config`, or fails with `AuthenticationFailed` — shared by `mks/env.ts`, `storage/env.ts` and `k3s/env.ts`. */
export const requiredEnv = (name: string): Effect.Effect<string, AuthenticationFailed> =>
  Config.string(name).pipe(Effect.mapError(() => _missingEnvHint(name)))

/** Same as `requiredEnv`, for secrets — never observable as a plain string outside the OAuth2 request boundary that unwraps it. */
export const requiredRedactedEnv = (name: string): Effect.Effect<Redacted.Redacted<string>, AuthenticationFailed> =>
  Config.redacted(name).pipe(Effect.mapError(() => _missingEnvHint(name)))
