import { Config, Context, Effect, Layer, Option, Redacted } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { KeystoneAuth, KeystoneAuthLive, loadCredentials } from "@kumulo/openstack"

export const OS_ENV_KEYS = [
  "OS_AUTH_URL",
  "OS_REGION_NAME",
  "OS_APPLICATION_CREDENTIAL_ID",
  "OS_USERNAME",
  "OS_PROJECT_NAME",
  "OS_USER_DOMAIN_NAME",
  "OS_PROJECT_DOMAIN_NAME",
  "OS_CLIENT_CONFIG_FILE",
  "OS_CLOUD"
] as const

export const OS_SECRET_ENV_KEYS = ["OS_APPLICATION_CREDENTIAL_SECRET", "OS_PASSWORD"] as const

// `Schema.String`/`Schema.Redacted(Schema.String)` accept any string, so the
// only way `Config.option` here fails is missing data — already folded into
// `None` — `orDie` just documents that the remaining `ConfigError` channel is
// unreachable, keeping this read (like `DoctorCheck.run`) never-failing.
const _optionalEnv = (name: string): Effect.Effect<readonly [string, string | undefined]> =>
  Config.option(Config.string(name)).pipe(
    Effect.map((value) => [name, Option.getOrUndefined(value)] as const),
    Effect.orDie
  )

const _optionalSecretEnv = (name: string): Effect.Effect<readonly [string, string | undefined]> =>
  Config.option(Config.redacted(name)).pipe(
    Effect.map((value) => [name, Option.map(value, Redacted.value).pipe(Option.getOrUndefined)] as const),
    Effect.orDie
  )

/** All `OS_*` env vars `loadCredentials` reads, sourced from `Config` instead of raw `process.env`. */
const _readOsEnv: Effect.Effect<Readonly<Record<string, string | undefined>>> = Effect.gen(function*() {
  const entries = yield* Effect.all([
    ...OS_ENV_KEYS.map(_optionalEnv),
    ...OS_SECRET_ENV_KEYS.map(_optionalSecretEnv)
  ])
  return Object.fromEntries(entries)
})

export interface OpenStackEnvShape {
  readonly keystone: Context.Service.Shape<typeof KeystoneAuth> | undefined
  readonly region: string | undefined
  readonly unavailableReason: string | undefined
}

/** Holds the OpenStack Keystone auth + region for whichever distro needs it (k3s, M7; OpenStack doctor checks now). */
export class OpenStackEnv extends Context.Service<OpenStackEnv, OpenStackEnvShape>()("@kumulo/cli/OpenStackEnv") {}

/**
 * Never-failing (mirrors the `DoctorCheck.run` contract): missing OS_* env
 * vars / clouds.yaml must not break the `ovh-mks` command paths that share
 * this same Layer graph in `main.ts` — the gap surfaces as an
 * `openstack-keystone-auth` doctor-check failure instead of a boot crash.
 */
export const OpenStackEnvLive: Layer.Layer<OpenStackEnv, never, HttpClient.HttpClient> = Layer.effect(
  OpenStackEnv,
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const env = yield* _readOsEnv
    return yield* loadCredentials(env).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.succeed<OpenStackEnvShape>({ keystone: undefined, region: undefined, unavailableReason: error.hint }),
        onSuccess: (credentials) =>
          Effect.provide(
            KeystoneAuth,
            Layer.provide(KeystoneAuthLive({ credentials }), Layer.succeed(HttpClient.HttpClient, client))
          ).pipe(
            Effect.map((keystone): OpenStackEnvShape => ({ keystone, region: credentials.region, unavailableReason: undefined }))
          )
      })
    )
  })
)
