import { Effect, Predicate, Schema } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { toDnsError } from "../../src/provider/errors.ts"

const _cause = (status: number, body: string, headers?: Record<string, string>) => {
  const request = HttpClientRequest.get("https://x.invalid/a")
  const response = HttpClientResponse.fromWeb(request, new Response(body, { status, headers }))

  return new HttpClientError.HttpClientError({ reason: new HttpClientError.StatusCodeError({ request, response }) })
}

const _map = (status: number, body: string, headers?: Record<string, string>) =>
  toDnsError({ cause: _cause(status, body, headers), zone: "a.com", name: "www" })

const _err = (code: string, message = "boom") => JSON.stringify({ code, message })

it.effect("401 names an expired or revoked token", () =>
  Effect.gen(function*() {
    const error = yield* _map(401, _err("UNABLE_TO_AUTHENTICATE"))
    assert.isTrue(Predicate.isTagged(error, "AuthenticationFailed"))

    if (Predicate.isTagged(error, "AuthenticationFailed")) {
      assert.include(error.hint, "expired")
      assert.include(error.hint, "revoked")
      assert.include(error.hint, "UNABLE_TO_AUTHENTICATE")
    }
  }))

it.effect("403 names both causes and carries the GoDaddy code", () =>
  Effect.gen(function*() {
    const error = yield* _map(403, _err("ACCESS_DENIED", "Authenticated user is not allowed access"))
    assert.isTrue(Predicate.isTagged(error, "AuthenticationFailed"))

    if (Predicate.isTagged(error, "AuthenticationFailed")) {
      assert.include(error.hint, "domains.dns:update")
      assert.include(error.hint, "not eligible for the DNS API")
      assert.include(error.hint, "at least one domain or a qualifying plan")
      assert.include(error.hint, "ACCESS_DENIED")
      assert.include(error.hint, "not allowed access")
    }
  }))

it.effect("404 maps to ResourceNotFound mentioning the account", () =>
  Effect.gen(function*() {
    const error = yield* _map(404, _err("UNKNOWN_DOMAIN"))
    assert.isTrue(Predicate.isTagged(error, "ResourceNotFound"))

    if (Predicate.isTagged(error, "ResourceNotFound")) assert.include(error.ref, "zone not in this GoDaddy account")
  }))

it.effect("409 maps to ResourceConflict", () =>
  Effect.gen(function*() {
    assert.isTrue(Predicate.isTagged(yield* _map(409, _err("DUPLICATE_RECORD")), "ResourceConflict"))
  }))

it.effect("422 maps to ProviderApiError carrying the code", () =>
  Effect.gen(function*() {
    const error = yield* _map(422, _err("INVALID_BODY"))
    assert.isTrue(Predicate.isTagged(error, "ProviderApiError"))

    if (Predicate.isTagged(error, "ProviderApiError")) {
      assert.strictEqual(error.status, 422)
      assert.include(error.operation, "INVALID_BODY")
    }
  }))

it.effect("429 prefers the Retry-After header and falls back to retryAfterSec", () =>
  Effect.gen(function*() {
    const header = yield* _map(429, JSON.stringify({ code: "TOO_MANY_REQUESTS", retryAfterSec: 9 }), { "Retry-After": "4" })
    const body = yield* _map(429, JSON.stringify({ code: "TOO_MANY_REQUESTS", retryAfterSec: 9 }))
    assert.isTrue(Predicate.isTagged(header, "RateLimited"))

    if (Predicate.isTagged(header, "RateLimited")) assert.strictEqual(header.retryAfter, "4")

    assert.isTrue(Predicate.isTagged(body, "RateLimited"))

    if (Predicate.isTagged(body, "RateLimited")) assert.strictEqual(body.retryAfter, "9")
  }))

it.effect("other statuses map to ProviderApiError with the body", () =>
  Effect.gen(function*() {
    const error = yield* _map(500, "oops")
    assert.isTrue(Predicate.isTagged(error, "ProviderApiError"))

    if (Predicate.isTagged(error, "ProviderApiError")) {
      assert.strictEqual(error.status, 500)
      assert.strictEqual(error.body, "oops")
    }
  }))

it.effect("a schema failure maps to ResponseDecodeError", () =>
  Effect.gen(function*() {
    const cause = yield* Schema.decodeUnknownEffect(Schema.String)(1).pipe(Effect.flip)
    const error = yield* toDnsError({ cause, zone: "a.com", name: "www" })
    assert.isTrue(Predicate.isTagged(error, "ResponseDecodeError"))
  }))

it.effect("a failure without a response maps to HttpTransportError", () =>
  Effect.gen(function*() {
    const request = HttpClientRequest.get("https://x.invalid/a")
    const cause = new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request }) })
    assert.isTrue(Predicate.isTagged(yield* toDnsError({ cause, zone: "a.com", name: "www" }), "HttpTransportError"))
  }))
