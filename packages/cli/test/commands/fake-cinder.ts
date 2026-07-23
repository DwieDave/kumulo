import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import type { HttpClientRequest } from "effect/unstable/http"
import { CinderAuth } from "@kumulo/volumes-cinder"

export type RouteHandler = (
  request: HttpClientRequest.HttpClientRequest
) => { readonly status: number; readonly body?: unknown }

// kumulo: local copy of `volumes-cinder/test/fake-cinder.ts`'s fixture-replay
// harness — dep-lint scopes `test/` per-package, so a cross-package test
// import isn't available here (same precedent as `core/k8s`'s
// `fake-http-client.ts`).
export const makeFakeCinder = (routes: Record<string, RouteHandler>): Layer.Layer<CinderAuth | HttpClient.HttpClient> => {
  const client = HttpClient.make((request) => {
    const url = new URL(request.url)
    const key = `${request.method} ${url.pathname}`
    const handler = routes[key]
    if (handler === undefined) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("not found", { status: 404 })))
    }
    const result = handler(request)
    const nullBodyStatus = result.status === 204 || result.status === 304
    const body = nullBodyStatus || result.body === undefined ? null : JSON.stringify(result.body)
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, { status: result.status })))
  })
  const auth = Layer.succeed(CinderAuth, { token: Effect.succeed("tok"), endpoint: Effect.succeed("https://cinder.example.com/") })
  return Layer.merge(auth, Layer.succeed(HttpClient.HttpClient, client))
}
