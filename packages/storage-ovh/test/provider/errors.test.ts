import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeStorageClient } from "../../src/client/storage.ts"
import { toStorageError } from "../../src/provider/errors.ts"

const _ctx = { kind: "bucket", ref: "DE1/staging-eu-backups" }

const _client = (response: () => Response) =>
  makeStorageClient(
    HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, response()))).pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
    )
  )

/** Real client failure for the given canned response, mapped through `toStorageError`. */
const _errorFor = (init: { readonly status: number; readonly body?: string; readonly headers?: Record<string, string> }) =>
  Effect.map(
    Effect.flip(_client(() => new Response(init.body ?? "{}", { status: init.status, headers: init.headers })).getStorageContainerOnRegion(
      "kumulo-project",
      "DE1",
      "staging-eu-backups",
      undefined
    )),
    (cause) => toStorageError({ cause, ctx: _ctx })
  )

describe("toStorageError — status → tag", () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [401, "AuthenticationFailed"],
    [403, "AuthenticationFailed"],
    [404, "ResourceNotFound"],
    [409, "ResourceConflict"],
    [413, "RateLimited"],
    [429, "RateLimited"],
    [402, "ProviderApiError"],
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
      const error = yield* _errorFor({ status: 429, headers: { "retry-after": "30" } })
      assert.strictEqual(error._tag === "RateLimited" ? error.retryAfter : undefined, "30")
    }))

  it.effect("5xx keeps the real status instead of a fabricated quota", () =>
    Effect.gen(function*() {
      const error = yield* _errorFor({ status: 500 })
      assert.strictEqual(error._tag === "ProviderApiError" ? error.status : undefined, 500)
    }))

  it.effect("a decode failure becomes ResponseDecodeError, not a status tag", () =>
    Effect.gen(function*() {
      const error = yield* _errorFor({ status: 200, body: JSON.stringify({ name: 42 }) })
      assert.strictEqual(error._tag, "ResponseDecodeError")
    }))
})
