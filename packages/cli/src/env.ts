import type { Redacted } from "effect";
import { Config, Effect } from "effect"
import { AuthenticationFailed } from "@kumulo/core"

const _envHint = (name: string) => (error: Config.ConfigError): AuthenticationFailed =>
  new AuthenticationFailed({
    hint: error.cause._tag === "SourceError"
      ? `could not read ${name}: ${error.cause.message}`
      : `missing required env var ${name}`
  })

export const requiredEnv = (name: string): Effect.Effect<string, AuthenticationFailed> =>
  Config.string(name).pipe(Effect.mapError(_envHint(name)))

export const requiredRedactedEnv = (name: string): Effect.Effect<Redacted.Redacted<string>, AuthenticationFailed> =>
  Config.redacted(name).pipe(Effect.mapError(_envHint(name)))
