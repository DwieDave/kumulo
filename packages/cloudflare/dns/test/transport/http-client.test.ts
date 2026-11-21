import { Effect, Redacted } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { CLOUDFLARE_API_BASE_URL, makeCloudflareHttpClient } from "../../src/transport/http-client.ts"

const _recording = (status = 200) => {
  const seen: Array<{ readonly url: string; readonly method: string; readonly auth: string | undefined }> = []

  const base = HttpClient.make((request) =>
    Effect.sync(() => {
      seen.push({ url: request.url, method: request.method, auth: request.headers.authorization })

      return HttpClientResponse.fromWeb(request, new Response(null, { status }))
    })
  )

  return { seen, base }
}

it.effect("sends Bearer auth and prefixes the base URL onto relative URLs only", () =>
  Effect.gen(function*() {
    const { base, seen } = _recording()
    const client = yield* makeCloudflareHttpClient({ base, token: Redacted.make("cf-token"), baseUrl: "https://fixture.invalid/client/v4" })
    yield* client.execute(HttpClientRequest.get("/zones?name=a.com"))
    yield* client.execute(HttpClientRequest.get("https://other.invalid/x"))
    assert.strictEqual(seen[0]?.url, "https://fixture.invalid/client/v4/zones?name=a.com")
    assert.strictEqual(seen[0]?.auth, "Bearer cf-token")
    assert.strictEqual(seen[1]?.url, "https://other.invalid/x")
  }))

it.effect("defaults to the v4 client API base", () =>
  Effect.gen(function*() {
    const { base, seen } = _recording()
    const client = yield* makeCloudflareHttpClient({ base, token: Redacted.make("t") })
    yield* client.execute(HttpClientRequest.get("/zones"))
    assert.strictEqual(CLOUDFLARE_API_BASE_URL, "https://api.cloudflare.com/client/v4")
    assert.strictEqual(seen[0]?.url, "https://api.cloudflare.com/client/v4/zones")
  }))

it.effect("does not retry a POST that failed with a 5xx", () =>
  Effect.gen(function*() {
    const { base, seen } = _recording(503)
    const client = yield* makeCloudflareHttpClient({ base, token: Redacted.make("t") })
    yield* client.execute(HttpClientRequest.post("/zones/z/dns_records"))
    assert.strictEqual(seen.length, 1)
  }))
