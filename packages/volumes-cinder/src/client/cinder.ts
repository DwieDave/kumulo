import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { HttpApiClient } from "effect/unstable/httpapi"
import { CinderAuth } from "../auth.ts"
import { Cinder } from "../generated/cinder.ts"

const _baseUrl = (endpoint: string): string => endpoint.replace(/\/+$/, "")

export const makeCinderClient = Effect.gen(function*() {
  const auth = yield* CinderAuth
  const endpoint = yield* auth.endpoint
  const token = yield* auth.token
  return yield* HttpApiClient.make(Cinder, {
    baseUrl: _baseUrl(endpoint),
    transformClient: HttpClient.mapRequest((request) => HttpClientRequest.setHeader(request, "X-Auth-Token", token))
  })
})

export type CinderClient = Effect.Success<typeof makeCinderClient>
