import type * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"

/**
 * The JSON a request carries, for tests that assert on the wire body.
 *
 * kumulo: `HttpBody` is a tagged union, so `_tag === "Uint8Array"` narrows to
 * the variant that has `.body` — no `as` needed (the repo's `no-type-assertion`
 * rule forbids one, and three client test files had each written the same cast).
 */
export const capturedJson = (request: HttpClientRequest.HttpClientRequest): unknown => {
  const body = request.body
  return body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(body.body)) : {}
}
