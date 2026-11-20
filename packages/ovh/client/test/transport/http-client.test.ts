import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { OvhAuth } from "../../src/auth/port.ts"
import { ovhHttpClientLive } from "../../src/transport/http-client.ts"

const _run = (
  { method, statuses }: { readonly method: "GET" | "POST"; readonly statuses: ReadonlyArray<number> }
) =>
  Effect.gen(function*() {
    const seen: Array<string | undefined> = []

    const base = HttpClient.make((request) => {
      seen.push(request.headers["authorization"])

      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}", { status: statuses[Math.min(seen.length, statuses.length) - 1] ?? 200 })))
    })

    const layer = ovhHttpClientLive("https://fixture.invalid").pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, base)),
      Layer.provide(Layer.succeed(OvhAuth, { token: Effect.succeed("tok") }))
    )

    const client = yield* HttpClient.HttpClient.pipe(Effect.provide(layer))
    const response = yield* client.execute(method === "GET" ? HttpClientRequest.get("/x") : HttpClientRequest.post("/x"))

    return { status: response.status, seen }
  })

describe("ovhHttpClientLive", () => {
  it.live("signs requests with the bearer token", () =>
    Effect.gen(function*() {
      const { seen } = yield* _run({ method: "GET", statuses: [200] })
      assert.deepStrictEqual(seen, ["Bearer tok"])
    }))

  it.live("retries a GET after a 503", () =>
    Effect.gen(function*() {
      const { seen, status } = yield* _run({ method: "GET", statuses: [503, 200] })
      assert.strictEqual(status, 200)
      assert.strictEqual(seen.length, 2)
    }))

  it.live("never retries a POST", () =>
    Effect.gen(function*() {
      const { seen, status } = yield* _run({ method: "POST", statuses: [503, 200] })
      assert.strictEqual(status, 503)
      assert.strictEqual(seen.length, 1)
    }))
})
