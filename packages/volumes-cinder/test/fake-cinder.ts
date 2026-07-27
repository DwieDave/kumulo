import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import type { HttpClientRequest } from "effect/unstable/http"
import { CinderAuth } from "../src/auth.ts"

export type RouteHandler = (
  request: HttpClientRequest.HttpClientRequest
) => { readonly status: number; readonly body?: unknown; readonly headers?: Record<string, string> }

export interface FakeCinder {
  readonly layer: Layer.Layer<CinderAuth | HttpClient.HttpClient>
  readonly calls: () => ReadonlyArray<{ readonly method: string; readonly url: string }>
}

// Fixture-replay fake: routes `${METHOD} ${pathname}` (query string
// stripped) through a caller-supplied handler map — offline, no real
// network, mirrors @kumulo/openstack's fake-openstack.ts test harness.
export const makeFakeCinder = (routes: Record<string, RouteHandler>): FakeCinder => {
  const calls: Array<{ method: string; url: string }> = []
  const client = HttpClient.make((request) => {
    const url = new URL(request.url)
    calls.push({ method: request.method, url: request.url })
    const key = `${request.method} ${url.pathname}`
    const handler = routes[key]
    if (handler === undefined) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("not found", { status: 404 })))
    }
    const result = handler(request)
    const nullBodyStatus = result.status === 204 || result.status === 304
    const responseBody = nullBodyStatus || result.body === undefined ? null : JSON.stringify(result.body)
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(responseBody, { status: result.status, headers: result.headers }))
    )
  })
  const auth = Layer.succeed(CinderAuth, {
    token: Effect.succeed("tok"),
    endpoint: Effect.succeed("https://cinder.example.com/")
  })
  return {
    layer: Layer.merge(auth, Layer.succeed(HttpClient.HttpClient, client)),
    calls: () => calls
  }
}
