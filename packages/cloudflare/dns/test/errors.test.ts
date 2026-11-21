import { Effect, Predicate, Schema } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { toDnsError } from "../src/errors.ts"

const _cause = (status: number, body: string, headers?: Record<string, string>) => {
  const request = HttpClientRequest.get("https://x.invalid/a")
  const response = HttpClientResponse.fromWeb(request, new Response(body, { status, headers }))

  return new HttpClientError.HttpClientError({ reason: new HttpClientError.StatusCodeError({ request, response }) })
}

const _map = (status: number, body: string, headers?: Record<string, string>) =>
  toDnsError({ cause: _cause(status, body, headers), zone: "a.com", name: "www" })

// api-response-common-failure from the spec
const _failure = (code: number, message: string) => JSON.stringify({ success: false, errors: [{ code, message }], messages: [], result: null })

it.effect("401 names a missing, expired or revoked CLOUDFLARE_API_TOKEN and carries the code", () =>
  Effect.gen(function*() {
    const error = yield* _map(401, _failure(10000, "Authentication error"))
    assert.isTrue(Predicate.isTagged(error, "AuthenticationFailed"))

    if (Predicate.isTagged(error, "AuthenticationFailed")) {
      assert.include(error.hint, "CLOUDFLARE_API_TOKEN")
      assert.include(error.hint, "expired or revoked")
      assert.include(error.hint, "10000: Authentication error")
    }
  }))

it.effect("403 names the permissions the token needs", () =>
  Effect.gen(function*() {
    const error = yield* _map(403, _failure(10000, "Authentication error"))
    assert.isTrue(Predicate.isTagged(error, "AuthenticationFailed"))

    if (Predicate.isTagged(error, "AuthenticationFailed")) {
      assert.include(error.hint, "Zone:Read and DNS:Edit")
      assert.include(error.hint, "10000")
    }
  }))

it.effect("404 maps to ResourceNotFound mentioning the token", () =>
  Effect.gen(function*() {
    const error = yield* _map(404, _failure(81044, "Record does not exist."))
    assert.isTrue(Predicate.isTagged(error, "ResourceNotFound"))

    if (Predicate.isTagged(error, "ResourceNotFound")) assert.include(error.ref, "not visible to this Cloudflare token")
  }))

it.effect("400 maps to ProviderApiError carrying every error code", () =>
  Effect.gen(function*() {
    const body = JSON.stringify({ success: false, errors: [{ code: 81053, message: "exists" }, { code: 9021, message: "ttl" }], messages: [], result: null })
    const error = yield* _map(400, body)
    assert.isTrue(Predicate.isTagged(error, "ProviderApiError"))

    if (Predicate.isTagged(error, "ProviderApiError")) {
      assert.strictEqual(error.status, 400)
      assert.include(error.operation, "[81053,9021]")
    }
  }))

it.effect("429 maps to RateLimited with the Retry-After header", () =>
  Effect.gen(function*() {
    const error = yield* _map(429, _failure(971, "slow down"), { "Retry-After": "7" })
    assert.isTrue(Predicate.isTagged(error, "RateLimited"))

    if (Predicate.isTagged(error, "RateLimited")) assert.strictEqual(error.retryAfter, "7")
  }))

it.effect("409 keeps the default ResourceConflict", () =>
  Effect.gen(function*() {
    assert.isTrue(Predicate.isTagged(yield* _map(409, _failure(1000, "conflict")), "ResourceConflict"))
  }))

it.effect("an unparseable body still maps, with no error body named", () =>
  Effect.gen(function*() {
    const error = yield* _map(401, "<html>nope</html>")

    if (Predicate.isTagged(error, "AuthenticationFailed")) assert.include(error.hint, "no error body")
    else assert.fail("expected AuthenticationFailed")
  }))

it.effect("5xx maps to ProviderApiError with the body truncated to 512 characters", () =>
  Effect.gen(function*() {
    const error = yield* _map(502, "x".repeat(5000))

    if (Predicate.isTagged(error, "ProviderApiError")) {
      assert.strictEqual(error.status, 502)
      assert.strictEqual(error.body.length, 512)
    } else assert.fail("expected ProviderApiError")
  }))

it.effect("a schema failure maps to ResponseDecodeError", () =>
  Effect.gen(function*() {
    const cause = yield* Schema.decodeUnknownEffect(Schema.String)(1).pipe(Effect.flip)
    assert.isTrue(Predicate.isTagged(yield* toDnsError({ cause, zone: "a.com", name: "www" }), "ResponseDecodeError"))
  }))

it.effect("a failure without a response maps to HttpTransportError", () =>
  Effect.gen(function*() {
    const request = HttpClientRequest.get("https://x.invalid/a")
    const cause = new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request }) })
    assert.isTrue(Predicate.isTagged(yield* toDnsError({ cause, zone: "a.com", name: "www" }), "HttpTransportError"))
  }))
