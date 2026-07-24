import { Context, Effect, Layer } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { AuthenticationFailed } from "@kumulo/core"
import { makeMksClient, type Mks } from "@kumulo/distro-ovh-mks"
import { OvhAuthLive, ovhHttpClientLayer } from "@kumulo/provider-ovh"

export interface MksEnvShape {
  readonly mks: Mks
  readonly serviceName: string
}

/**
 * Holds the composed MKS API client + the OVH cloud project id (`serviceName`)
 * that every MKS endpoint is scoped under. `ClusterConfig` has no such field
 * (it's an OVH account concept, not part of the cluster shape) — read from
 * env, same as the OAuth2 client credentials.
 */
export class MksEnv extends Context.Service<MksEnv, MksEnvShape>()("@kumulo/cli/MksEnv") {}

/** Reads a required env var, or fails with `AuthenticationFailed` — shared with `storage/env.ts`'s own OVH client-credentials build. */
export const requiredEnv = (name: string): Effect.Effect<string, AuthenticationFailed> => {
  const value = process.env[name]
  return value === undefined || value.length === 0
    ? Effect.fail(new AuthenticationFailed({ hint: `missing required env var ${name}` }))
    : Effect.succeed(value)
}

/** Live wiring for the ovh-mks path: OAuth2 client-credentials auth + the generated MKS client. */
export const MksEnvLive: Layer.Layer<MksEnv, AuthenticationFailed, HttpClient.HttpClient> = Layer.effect(
  MksEnv,
  Effect.gen(function*() {
    const clientId = yield* requiredEnv("OVH_CLIENT_ID")
    const clientSecret = yield* requiredEnv("OVH_CLIENT_SECRET")
    const serviceName = yield* requiredEnv("OVH_SERVICE_NAME")
    const authLayer = OvhAuthLive({ clientId, clientSecret })
    const httpClientLayer = ovhHttpClientLayer().pipe(Layer.provide(authLayer))
    const httpClient = yield* Effect.provide(HttpClient.HttpClient, httpClientLayer)
    return { mks: makeMksClient(httpClient), serviceName }
  })
)
