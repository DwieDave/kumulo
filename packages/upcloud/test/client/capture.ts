import type * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"

export const capturedJson = (request: HttpClientRequest.HttpClientRequest): unknown => {
  const body = request.body
  return body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(body.body)) : {}
}
