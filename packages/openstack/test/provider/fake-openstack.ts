import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { KeystoneAuth } from "../../src/auth/keystone-auth.ts"

export const requestJson = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined

export type RouteHandler = (
  request: HttpClientRequest.HttpClientRequest
) => { readonly status: number; readonly body?: unknown }

export interface FakeOpenStack {
  readonly layer: Layer.Layer<KeystoneAuth | HttpClient.HttpClient>
  readonly calls: () => ReadonlyArray<{ readonly method: string; readonly url: string }>
}

export const makeFakeOpenStack = (
  routes: Record<string, RouteHandler>
): FakeOpenStack => {
  const calls: Array<{ method: string; url: string }> = []
  const client = HttpClient.make((request) => {
    // HttpClientRequest keeps the query in urlParams, not .url; merge like a real client does
    const url = new URL(request.url)
    for (const [key, value] of request.urlParams) url.searchParams.append(key, value)
    calls.push({ method: request.method, url: url.toString() })
    const key = `${request.method} ${url.pathname}`
    const handler = routes[key]
    if (handler === undefined) {
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("not found", { status: 404 })))
    }
    const result = handler(HttpClientRequest.setUrl(request, url.toString()))
    const nullBodyStatus = result.status === 204 || result.status === 304
    const responseBody = nullBodyStatus || result.body === undefined ? null : JSON.stringify(result.body)
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(responseBody, { status: result.status }))
    )
  })
  const auth = Layer.succeed(KeystoneAuth, {
    token: Effect.succeed("tok"),
    invalidate: Effect.void,
    endpoint: ({ service }) => Effect.succeed(`https://${service}.example.com/`)
  })
  return {
    layer: Layer.merge(auth, Layer.succeed(HttpClient.HttpClient, client)),
    calls: () => calls
  }
}
