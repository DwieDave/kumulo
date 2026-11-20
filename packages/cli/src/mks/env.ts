import { Context, Effect, Layer } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import type { AuthenticationFailed } from "@kumulo/core"
import { makeMksClient, type Mks } from "@kumulo/distro-ovh-mks"
import { requiredEnv } from "../env.ts"
import { ovhHttpClientFromEnv } from "../provider/ovh-http.ts"

export interface MksEnvFields {
  readonly mks: Mks
  readonly serviceName: string
}

export class MksEnv extends Context.Service<MksEnv, MksEnvFields>()("@kumulo/cli/MksEnv") {}

export const MksEnvLive: Layer.Layer<MksEnv, AuthenticationFailed, HttpClient.HttpClient> = Layer.effect(
  MksEnv,
  Effect.gen(function*() {
    const serviceName = yield* requiredEnv("OVH_SERVICE_NAME")
    const httpClient = yield* Effect.provide(HttpClient.HttpClient, ovhHttpClientFromEnv())

    return { mks: makeMksClient(httpClient), serviceName }
  })
)
