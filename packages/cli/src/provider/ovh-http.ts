import { Effect, Layer } from "effect"
import type * as HttpClient from "effect/http/HttpClient"
import type { AuthenticationFailed } from "@kumulo/core"
import { OvhAuthLive, ovhHttpClientLive } from "@kumulo/provider-ovh"
import { requiredEnv, requiredRedactedEnv } from "../env.ts"

export const ovhHttpClientFromEnv = (): Layer.Layer<HttpClient.HttpClient, AuthenticationFailed, HttpClient.HttpClient> =>
  Layer.unwrap(
    Effect.gen(function*() {
      const clientId = yield* requiredEnv("OVH_CLIENT_ID")
      const clientSecret = yield* requiredRedactedEnv("OVH_CLIENT_SECRET")

      return ovhHttpClientLive().pipe(Layer.provide(OvhAuthLive({ clientId, clientSecret })))
    })
  )
