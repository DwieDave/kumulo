import { Effect } from "effect"
import { assert, describe, it } from "@effect/vitest"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { Schema } from "effect"
import {
  AuthenticationFailed,
  CapabilityMissing,
  HttpTransportError,
  ProviderApiError,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "@kumulo/core"
import { mapBunnyResponse, mapBunnyStatus, parseBunnyErrorBody, toBunnyError } from "../../src/errors.ts"

const _ctx = { kind: "dns-record", ref: "example.com/www" }

const _request = HttpClientRequest.get("https://fixture.invalid/x")

const _response = (status: number, body: string, headers: Record<string, string> = {}) =>
  HttpClientResponse.fromWeb(_request, new Response(body, { status, headers }))

const _statusError = (status: number) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.StatusCodeError({ request: _request, response: _response(status, "") })
  })

describe("parseBunnyErrorBody", () => {
  it("decodes Core ApiErrorData", () => {
    const body = parseBunnyErrorBody(JSON.stringify({ ErrorKey: "dnszone.name_taken", Field: "Name", Message: "taken" }))
    assert.deepStrictEqual(body, { errorKey: "dnszone.name_taken", field: "Name", message: "taken" })
  })

  it("decodes Shield GenericRequestResponse", () => {
    const body = parseBunnyErrorBody(
      JSON.stringify({ success: false, message: "no", errorKey: "invalid_plan_type.bot_detection", statusCode: 202 })
    )

    assert.deepStrictEqual(body, { errorKey: "invalid_plan_type.bot_detection", field: undefined, message: "no" })
  })

  it("tolerates null fields", () => {
    const body = parseBunnyErrorBody(JSON.stringify({ ErrorKey: null, Field: null, Message: "only message" }))
    assert.deepStrictEqual(body, { errorKey: undefined, field: undefined, message: "only message" })
  })

  it("returns undefined for non-JSON and empty objects", () => {
    assert.strictEqual(parseBunnyErrorBody("<html>"), undefined)
    assert.strictEqual(parseBunnyErrorBody("{}"), undefined)
    assert.strictEqual(parseBunnyErrorBody(""), undefined)
  })
})

describe("mapBunnyStatus", () => {
  it("maps 401 and 403 to AuthenticationFailed", () => {
    for (const status of [401, 403]) {
      assert.instanceOf(mapBunnyStatus({ ..._ctx, status, body: undefined }), AuthenticationFailed)
    }
  })

  it("maps 404 to ResourceNotFound", () => {
    const error = mapBunnyStatus({ ..._ctx, status: 404, body: undefined })
    assert.instanceOf(error, ResourceNotFound)
    assert.deepStrictEqual(error instanceof ResourceNotFound ? [error.kind, error.ref] : [], ["dns-record", "example.com/www"])
  })

  it("maps 409 to ResourceConflict", () => {
    assert.instanceOf(mapBunnyStatus({ ..._ctx, status: 409, body: undefined }), ResourceConflict)
  })

  it("maps a duplicate ErrorKey to ResourceConflict even on 400", () => {
    const body = { errorKey: "dnszone.record_already_exists", message: "dup", field: undefined }
    assert.instanceOf(mapBunnyStatus({ ..._ctx, status: 400, body }), ResourceConflict)
  })

  it("maps 429 to RateLimited and keeps retry-after", () => {
    const error = mapBunnyStatus({ ..._ctx, status: 429, body: undefined, retryAfter: "7" })
    assert.instanceOf(error, RateLimited)
    assert.strictEqual(error instanceof RateLimited ? error.retryAfter : undefined, "7")
  })

  it("maps 202 invalid_plan_type.* to CapabilityMissing", () => {
    const body = { errorKey: "invalid_plan_type.bot_detection", message: "upgrade", field: undefined }
    const error = mapBunnyStatus({ ..._ctx, status: 202, body })
    assert.instanceOf(error, CapabilityMissing)
    assert.strictEqual(error instanceof CapabilityMissing ? error.capability : undefined, "invalid_plan_type.bot_detection")
  })

  it("maps other statuses to ProviderApiError with the detail", () => {
    const body = { errorKey: "k", message: "boom", field: "Name" }
    const error = mapBunnyStatus({ ..._ctx, status: 400, body })
    assert.instanceOf(error, ProviderApiError)
    assert.deepStrictEqual(
      error instanceof ProviderApiError ? [error.status, error.body] : [],
      [400, "k: Name: boom"]
    )
  })
})

describe("toBunnyError", () => {
  it("maps decode failures to ResponseDecodeError", () => {
    const failure = Effect.runSync(Effect.flip(Schema.decodeUnknownEffect(Schema.String)(1)))
    assert.instanceOf(toBunnyError({ ..._ctx, cause: failure }), ResponseDecodeError)
  })

  it("maps a response-less HttpClientError to HttpTransportError", () => {
    const cause = new HttpClientError.HttpClientError({
      reason: new HttpClientError.TransportError({ request: _request })
    })

    assert.instanceOf(toBunnyError({ ..._ctx, cause }), HttpTransportError)
  })

  it("maps status errors through mapBunnyStatus", () => {
    assert.instanceOf(toBunnyError({ ..._ctx, cause: _statusError(404) }), ResourceNotFound)
    assert.instanceOf(toBunnyError({ ..._ctx, cause: _statusError(401) }), AuthenticationFailed)
    assert.instanceOf(toBunnyError({ ..._ctx, cause: _statusError(500) }), ProviderApiError)
  })
})

describe("mapBunnyResponse", () => {
  it.effect("reads the Core body from the response", () =>
    Effect.gen(function*() {
      const response = _response(400, JSON.stringify({ ErrorKey: "dnszone.record_exists", Message: "dup" }))
      assert.instanceOf(yield* mapBunnyResponse({ ..._ctx, response }), ResourceConflict)
    }))

  it.effect("maps a Shield 202 plan rejection", () =>
    Effect.gen(function*() {
      const response = _response(
        202,
        JSON.stringify({ success: false, errorKey: "invalid_plan_type.bot_detection", message: "needs Advanced" })
      )

      assert.instanceOf(yield* mapBunnyResponse({ ..._ctx, response }), CapabilityMissing)
    }))

  it.effect("carries Retry-After on 429", () =>
    Effect.gen(function*() {
      const error = yield* mapBunnyResponse({ ..._ctx, response: _response(429, "", { "retry-after": "3" }) })
      assert.strictEqual(error instanceof RateLimited ? error.retryAfter : undefined, "3")
    }))
})
