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

export class MksEnv extends Context.Service<MksEnv, MksEnvShape>()("@kumulo/cli/MksEnv") {}

export const ovhHttpClientFromEnv = (): Layer.Layer<HttpClient.HttpClient, AuthenticationFailed, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function*() {
      const clientId = yield* requiredEnv("OVH_CLIENT_ID")
      const clientSecret = yield* requiredRedactedEnv("OVH_CLIENT_SECRET")
      return ovhHttpClientLive().pipe(Layer.provide(OvhAuthLive({ clientId, clientSecret })))
    })
  )

export const MksEnvLive: Layer.Layer<MksEnv, AuthenticationFailed, HttpClient.HttpClient> = Layer.effect(
  MksEnv,
  Effect.gen(function*() {
    const serviceName = yield* requiredEnv("OVH_SERVICE_NAME")
    const httpClient = yield* Effect.provide(HttpClient.HttpClient, ovhHttpClientFromEnv())
    return { mks: makeMksClient(httpClient), serviceName }
  })
)
