import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeMksClient } from "../../src/client/mks.ts"
import { toMksError } from "../../src/distro/errors.ts"

const _ctx = { kind: "cluster", ref: "staging" }

const _client = (response: () => Response) =>
  makeMksClient(
    HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, response()))).pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
    )
  )

/** Real client failure for the given canned response, mapped through `toMksError`. */
const _errorFor = (init: { readonly status: number; readonly body?: string; readonly headers?: Record<string, string> }) =>
  Effect.map(
    Effect.flip(
      _client(() => new Response(init.body ?? "{}", { status: init.status, headers: init.headers }))
        .getCloudProjectServiceNameKubeKubeId("kumulo-project", "kube-1", undefined)
    ),
    (cause) => toMksError({ cause, ctx: _ctx })
  )

describe("toMksError — status → tag", () => {
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
      const error = yield* _errorFor({ status: 429, headers: { "retry-after": "60" } })
      assert.strictEqual(error._tag === "RateLimited" ? error.retryAfter : undefined, "60")
    }))

  it.effect("a plain 402 is a provider error, not a fabricated quota", () =>
    Effect.gen(function*() {
      const error = yield* _errorFor({ status: 402, body: JSON.stringify({ message: "payment required" }) })
      assert.strictEqual(error._tag, "ProviderApiError")
    }))

  it.effect("a genuine quota signal reports no invented limit/requested", () =>
    Effect.gen(function*() {
      const error = yield* _errorFor({ status: 403, body: JSON.stringify({ message: "kube quota exceeded for project" }) })
      assert.strictEqual(error._tag, "QuotaExceeded")
      assert.strictEqual(error._tag === "QuotaExceeded" ? error.limit : 0, undefined)
      assert.strictEqual(error._tag === "QuotaExceeded" ? error.requested : 0, undefined)
    }))

  it.effect("5xx keeps the real status", () =>
    Effect.gen(function*() {
      const error = yield* _errorFor({ status: 500 })
      assert.strictEqual(error._tag === "ProviderApiError" ? error.status : undefined, 500)
    }))

  it.effect("a malformed body becomes ResponseDecodeError — never a success, conflict or auth error", () =>
    Effect.gen(function*() {
      const error = yield* _errorFor({ status: 200, body: JSON.stringify({ id: 42 }) })
      assert.strictEqual(error._tag, "ResponseDecodeError")
    }))
})
