import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import type { HttpClientRequest } from "effect/unstable/http"
import type { OpenStackEndpointResolver } from "../../src/doctor-openstack/nova.ts"

/** A `KeystoneAuth.endpoint`-shaped fake — always resolves to the same fixed base URL. */
export const fakeEndpointResolver = (base = "https://compute.example.com/"): OpenStackEndpointResolver => ({
  endpoint: () => Effect.succeed(base)
})

/** Fixture-replay fake HttpClient: one fixed `{ status, body? }` response for every request. */
export const fakeHttpClient = (response: { readonly status: number; readonly body?: unknown }): HttpClient.HttpClient =>
  HttpClient.make((request: HttpClientRequest.HttpClientRequest) => {
    const nullBodyStatus = response.status === 204 || response.status === 304
    const responseBody = nullBodyStatus || response.body === undefined ? null : JSON.stringify(response.body)
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(responseBody, { status: response.status }))
    )
  })
