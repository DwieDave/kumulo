import * as HttpClientRequest from "effect/http/HttpClientRequest"

// Idempotent: a request the bunny client already pointed at an absolute URL is left alone.
export const withFixtureBaseUrl = (request: HttpClientRequest.HttpClientRequest): HttpClientRequest.HttpClientRequest =>
  URL.canParse(request.url) ? request : HttpClientRequest.prependUrl(request, "https://fixture.invalid")
