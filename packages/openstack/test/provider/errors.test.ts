import {
  AuthenticationFailed,
  ProviderApiError,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "@kumulo/core"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Schema from "effect/Schema"
import { FastCheck as fc } from "effect/testing"
import { HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { statusError, toOpenStackError } from "../../src/provider/errors.ts"

const _at = (status: number, body = "") => statusError({ status, kind: "server", ref: "v2.1/servers", body })

describe("statusError", () => {
  it("maps the statuses OpenStack gives a distinct meaning", () => {
    expect(_at(404)).toBeInstanceOf(ResourceNotFound)
    expect(_at(409)).toBeInstanceOf(ResourceConflict)
    expect(_at(401)).toBeInstanceOf(AuthenticationFailed)
    expect(_at(403)).toBeInstanceOf(AuthenticationFailed)
  })

  it("treats a 403 as quota only when the body says so, and never fabricates a limit", () => {
    const quota = _at(403, "Quota exceeded for instances")
    expect(quota).toBeInstanceOf(QuotaExceeded)
    expect(quota).toMatchObject({ resource: "server" })
    if (quota._tag !== "QuotaExceeded") throw new Error(`expected QuotaExceeded, got ${quota._tag}`)
    expect(quota.limit).toBeUndefined()
    expect(quota.requested).toBeUndefined()
    expect(_at(403, "Policy doesn't allow os_compute_api:servers:create")).toBeInstanceOf(AuthenticationFailed)
  })

  // The whole point of the mapping: an outage must not read as bad credentials.
  it.prop("every 5xx is a provider error, never an auth failure", [fc.integer({ min: 500, max: 599 })], ([status]) => {
    const error = _at(status, "gateway blew up")
    expect(error).toBeInstanceOf(ProviderApiError)
    expect(error).not.toBeInstanceOf(AuthenticationFailed)
    expect(error).toMatchObject({ status, body: "gateway blew up", operation: "server v2.1/servers" })
  })

  it("reports 429/413 as rate limiting with the Retry-After verbatim", () => {
    const error = statusError({ status: 429, kind: "server", ref: "v2.1/servers", body: "slow down", retryAfter: "30" })
    expect(error).toBeInstanceOf(RateLimited)
    expect(error).toMatchObject({ kind: "server", ref: "v2.1/servers", retryAfter: "30" })
    expect(_at(413)).toBeInstanceOf(RateLimited)
  })

  it("keeps unclassified statuses distinguishable by their status code", () => {
    expect(_at(422, "unprocessable")).toMatchObject({ status: 422, body: "unprocessable" })
  })
})

const _map = toOpenStackError({ kind: "keystone-token", ref: "/v3/auth/tokens" })

const _clientError = (status: number, body: string, headers: Record<string, string> = {}) => {
  const request = HttpClientRequest.post("https://keystone.example.com/v3/auth/tokens")
  const response = HttpClientResponse.fromWeb(request, new Response(body, { status, headers }))
  return new HttpClientError.HttpClientError({
    reason: new HttpClientError.StatusCodeError({ request, response, description: body })
  })
}

describe("toOpenStackError", () => {
  // Regression: Keystone's rate limit and outage used to page as "bad credentials".
  it("never reports a Keystone 429 or 5xx as an authentication failure", () => {
    const limited = _map(_clientError(429, "slow down", { "retry-after": "12" }))
    expect(limited).toBeInstanceOf(RateLimited)
    expect(limited).toMatchObject({ retryAfter: "12" })
    const outage = _map(_clientError(503, "keystone is down"))
    expect(outage).toBeInstanceOf(ProviderApiError)
    expect(outage).not.toBeInstanceOf(AuthenticationFailed)
    expect(outage).toMatchObject({ status: 503, body: "keystone is down" })
  })

  it("still reports genuinely rejected credentials as an authentication failure", () => {
    expect(_map(_clientError(401, "bad credentials"))).toBeInstanceOf(AuthenticationFailed)
  })

  it("reports a schema failure as a decode error, not a not-found", () => {
    const schemaError = Effect.runSync(Effect.flip(Schema.decodeUnknownEffect(Schema.String)(42)))
    const mapped = _map(schemaError)
    expect(mapped).toBeInstanceOf(ResponseDecodeError)
    expect(mapped).not.toBeInstanceOf(ResourceNotFound)
    expect(mapped).toMatchObject({ endpoint: "keystone-token" })
  })
})
