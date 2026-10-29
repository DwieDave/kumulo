import { Predicate } from "effect"
import type { Schema } from "effect"
import type * as HttpClientRequest from "effect/http/HttpClientRequest"

export const capturedJson = (request: HttpClientRequest.HttpClientRequest): Schema.Json => {
  const body = request.body

  return Predicate.isTagged(body, "Uint8Array") ? JSON.parse(new TextDecoder().decode(body.body)) : {}
}
