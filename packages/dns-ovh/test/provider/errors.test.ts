import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeDnsClient } from "../../src/client/dns.ts"
import { toDnsError } from "../../src/provider/errors.ts"

const _client = (response: () => Response) =>
  makeDnsClient(
    HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, response()))).pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
    )
  )

/** Real client failure for the given canned response, mapped through `toDnsError`. */
const _errorFor = (init: { readonly status: number; readonly body?: string; readonly headers?: Record<string, string> }) =>
  Effect.map(
    Effect.flip(
      _client(() => new Response(init.body ?? "{}", { status: init.status, headers: init.headers }))
        .getRecord("example.com", "7", undefined)
    ),
    (cause) => toDnsError({ cause, zone: "example.com", name: "api" })
  )

describe("toDnsError — status → tag", () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [401, "AuthenticationFailed"],
    [403, "AuthenticationFailed"],
    [404, "ResourceNotFound"],
    [409, "ResourceConflict"],
    [413, "RateLimited"],
    [429, "RateLimited"],
    [422, "ProviderApiError"],
    [500, "ProviderApiError"],
    [503, "ProviderApiError"]
  ]

  for (const [status, tag] of cases) {
    it.effect(`${status} → ${tag}`, () =>
      Effect.gen(function*() {
        const error = yield* _errorFor({ status })
        assert.strictEqual(error._tag, tag)
      }))
  }

  it.effect("429 carries the Retry-After header verbatim", () =>
    Effect.gen(function*() {
      const error = yield* _errorFor({ status: 429, headers: { "retry-after": "12" } })
      assert.strictEqual(error._tag === "RateLimited" ? error.retryAfter : undefined, "12")
    }))

  it.effect("a DNS outage keeps its real status instead of reading as a conflict", () =>
    Effect.gen(function*() {
      const error = yield* _errorFor({ status: 503 })
      assert.strictEqual(error._tag === "ProviderApiError" ? error.status : undefined, 503)
    }))

  it.effect("a malformed body becomes ResponseDecodeError — never a success, conflict or auth error", () =>
    Effect.gen(function*() {
      const error = yield* _errorFor({ status: 200, body: JSON.stringify({ id: "not-a-number" }) })
      assert.strictEqual(error._tag, "ResponseDecodeError")
    }))
})
