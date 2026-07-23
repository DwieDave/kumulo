import { Context, Effect, Layer } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { KeystoneAuth, KeystoneAuthLive, loadCredentials } from "@kumulo/openstack"

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
    return yield* loadCredentials(process.env).pipe(
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
