import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

export const requestJson = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined

export type RouteHandler = (
  request: HttpClientRequest.HttpClientRequest
) => { readonly status: number; readonly body?: unknown; readonly headers?: Record<string, string> }

export interface FakeHcloud {
  readonly layer: Layer.Layer<HttpClient.HttpClient>
  readonly calls: () => ReadonlyArray<{ readonly method: string; readonly url: string }>
}

export const makeFakeHcloud = (
  routes: Record<string, RouteHandler>
): FakeHcloud => {
  const calls: Array<{ method: string; url: string }> = []
  const client = HttpClient.make((request) => {
    // HttpClientRequest keeps query params in urlParams, separate from url — merge them or every route sees a bare path.
    const url = new URL(request.url)
    for (const [key, value] of request.urlParams) url.searchParams.append(key, value)
    calls.push({ method: request.method, url: url.toString() })
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
