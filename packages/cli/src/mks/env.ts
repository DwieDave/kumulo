import { Context, Effect, Layer } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type { AuthenticationFailed } from "@kumulo/core"
import { makeMksClient, type Mks } from "@kumulo/distro-ovh-mks"
import { OvhAuthLive, ovhHttpClientLive } from "@kumulo/provider-ovh"
import { requiredEnv, requiredRedactedEnv } from "../env.ts"

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

/** OVH OAuth2 client-credentials-backed `HttpClient`, shared by `MksEnvLive`, `StorageEnvLive` and `k3sDnsProviderLayer`. */
export const ovhHttpClientFromEnv = (): Layer.Layer<HttpClient.HttpClient, AuthenticationFailed, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function*() {
      const clientId = yield* requiredEnv("OVH_CLIENT_ID")
      const clientSecret = yield* requiredRedactedEnv("OVH_CLIENT_SECRET")
      return ovhHttpClientLive().pipe(Layer.provide(OvhAuthLive({ clientId, clientSecret })))
    })
  )

/** Live wiring for the ovh-mks path: OAuth2 client-credentials auth + the generated MKS client. */
export const MksEnvLive: Layer.Layer<MksEnv, AuthenticationFailed, HttpClient.HttpClient> = Layer.effect(
  MksEnv,
  Effect.gen(function*() {
    const serviceName = yield* requiredEnv("OVH_SERVICE_NAME")
    const httpClient = yield* Effect.provide(HttpClient.HttpClient, ovhHttpClientFromEnv())
    return { mks: makeMksClient(httpClient), serviceName }
  })
)
