import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

/** The JSON payload a route handler received, or `undefined` for a bodyless request. */
export const requestJson = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined

export type RouteHandler = (
  request: HttpClientRequest.HttpClientRequest
) => { readonly status: number; readonly body?: unknown; readonly headers?: Record<string, string> }

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
    // kumulo: `HttpClientRequest` keeps query params in `urlParams`, separate
    // from `url` — the real transport merges them at execute time, so the fake
    // has to as well or every route sees a bare path.
    const url = new URL(request.url)
    for (const [key, value] of request.urlParams) url.searchParams.append(key, value)
    calls.push({ method: request.method, url: url.toString() })
    // kumulo: route keys are relative to hcloud's `/v1` API root (matching
    // `@kumulo/openstack`'s fake's relative-path convention) — strip it here
    // rather than repeating "/v1" in every test's route table.
    const key = `${request.method} ${url.pathname.replace(/^\/v1/, "")}`
    const handler = routes[key]
    if (handler === undefined) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("not found", { status: 404 })))
    }
    const result = handler(HttpClientRequest.setUrl(request, url.toString()))
    const nullBodyStatus = result.status === 204 || result.status === 304
    const responseBody = nullBodyStatus || result.body === undefined ? null : JSON.stringify(result.body)
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(responseBody, { status: result.status, headers: result.headers }))
    )
  })
  return { layer: Layer.succeed(HttpClient.HttpClient, client), calls: () => calls }
}
