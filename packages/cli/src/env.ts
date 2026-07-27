import type { Redacted } from "effect";
import { Config, Effect } from "effect"
import { AuthenticationFailed } from "@kumulo/core"

/**
 * A `ConfigError` means one of two very different things: the key was absent
 * from every source, or a source could not be read at all — a broken sops
 * secrets file (bad key, missing file, non-zero `sops` exit). Only the first is
 * "missing env var"; the second surfaces the sops stderr and file path (R6)
 * instead of silently degrading into it.
 */
const _envHint = (name: string) => (error: Config.ConfigError): AuthenticationFailed =>
  new AuthenticationFailed({
    hint: error.cause._tag === "SourceError"
      ? `could not read ${name}: ${error.cause.message}`
      : `missing required env var ${name}`
  })

/** Reads a required env var via `Config`, or fails with `AuthenticationFailed` — shared by `mks/env.ts`, `storage/env.ts` and `k3s/env.ts`. */
export const requiredEnv = (name: string): Effect.Effect<string, AuthenticationFailed> =>
  Config.string(name).pipe(Effect.mapError(_envHint(name)))

/** Same as `requiredEnv`, for secrets — never observable as a plain string outside the OAuth2 request boundary that unwraps it. */
export const requiredRedactedEnv = (name: string): Effect.Effect<Redacted.Redacted<string>, AuthenticationFailed> =>
  Config.redacted(name).pipe(Effect.mapError(_envHint(name)))
