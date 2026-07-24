import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import type { HttpClientRequest } from "effect/unstable/http"

export type RouteHandler = (
  request: HttpClientRequest.HttpClientRequest
) => { readonly status: number; readonly body?: unknown }

export interface FakeHcloud {
  readonly layer: Layer.Layer<HttpClient.HttpClient>
  readonly calls: () => ReadonlyArray<{ readonly method: string; readonly url: string }>
}

// Fixture-replay fake: routes `${METHOD} ${pathname}` (query string stripped)
// through a caller-supplied handler map — offline, no real network. Mirrors
// `@kumulo/openstack`'s `fake-openstack.ts` (duplicated, not imported —
// dependency-cruiser forbids sibling-package imports between providers).
export const makeFakeHcloud = (
  routes: Record<string, RouteHandler>
): FakeHcloud => {
  const calls: Array<{ method: string; url: string }> = []
  const client = HttpClient.make((request) => {
    const url = new URL(request.url)
    calls.push({ method: request.method, url: request.url })
    // kumulo: route keys are relative to hcloud's `/v1` API root (matching
    // `@kumulo/openstack`'s fake's relative-path convention) — strip it here
    // rather than repeating "/v1" in every test's route table.
    const key = `${request.method} ${url.pathname.replace(/^\/v1/, "")}`
    const handler = routes[key]
    if (handler === undefined) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("not found", { status: 404 })))
    }
    const result = handler(request)
    const nullBodyStatus = result.status === 204 || result.status === 304
    const responseBody = nullBodyStatus || result.body === undefined ? null : JSON.stringify(result.body)
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(responseBody, { status: result.status })))
  })
  return { layer: Layer.succeed(HttpClient.HttpClient, client), calls: () => calls }
}
