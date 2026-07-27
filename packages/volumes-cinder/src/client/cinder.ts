/**
 * Thin, friendlier wrapper around the generated Cinder client.
 *
 * `src/generated/cinder.ts` is an `HttpApi` *declaration*; `HttpApiClient.make`
 * turns it into the request-building, schema-decoding client the provider calls.
 *
 * Base URL and token both come from the `CinderAuth` port rather than from
 * `@kumulo/openstack`'s Keystone auth directly — dependency-cruiser forbids the
 * sibling import, so that composition happens at the CLI wiring layer.
 */
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { HttpApiClient } from "effect/unstable/httpapi"
import { CinderAuth } from "../auth.ts"
import { Cinder } from "../generated/cinder.ts"

// The catalog URL may carry a trailing slash; the generated paths are absolute.
const _baseUrl = (endpoint: string): string => endpoint.replace(/\/+$/, "")

/**
 * kumulo: the token is read once per client rather than once per request —
 * `HttpClient`'s error channel is fixed to `HttpClientError`, so a per-request
 * `auth.token` effect could not surface its own failures there. Callers build a
 * client per provider operation, so a refreshed token is picked up on the next one.
 */
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
