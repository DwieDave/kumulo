import { Effect, Redacted } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeHetznerHttpClient } from "../../src/transport/http-client.ts"

const _rawHttpClient = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request))))

it.effect("sends the bearer token and prepends the Hetzner API base URL", () =>
  Effect.gen(function*() {
    let captured: { readonly url: string; readonly auth: string | undefined } | undefined
    const base = _rawHttpClient((request) => {
      captured = { url: request.url, auth: request.headers.authorization }
      return new Response(null, { status: 200 })
    })
    const client = makeHetznerHttpClient({ base, token: Redacted.make("secret-token"), baseUrl: "https://fixture.invalid" })
    yield* client.execute(HttpClientRequest.get("/zones/example.com"))
    assert.strictEqual(captured?.url, "https://fixture.invalid/zones/example.com")
    assert.strictEqual(captured?.auth, "Bearer secret-token")
  }))

// kumulo: real backoff delays elapse here — @effect/vitest's it.effect runs
// under a virtual TestClock that never auto-advances, so timing-dependent
// retry cases use plain it()/runPromise against the real clock instead
// (mirrors openstack/test/transport/http-client.test.ts).
it("retries on 429 and eventually succeeds", async () => {
  let calls = 0
  const base = _rawHttpClient(() => {
    calls++
    return new Response(null, { status: calls < 3 ? 429 : 200 })
  })
  const client = makeHetznerHttpClient({ base, token: Redacted.make("secret-token"), baseUrl: "https://fixture.invalid" })
  const response = await Effect.runPromise(client.execute(HttpClientRequest.get("/zones/example.com")))
  assert.strictEqual(response.status, 200)
  assert.strictEqual(calls, 3)
}, 10_000)

it("gives up after the max retry bound on a persistent 5xx", async () => {
  let calls = 0
  const base = _rawHttpClient(() => {
    calls++
    return new Response(null, { status: 503 })
  })
  const client = makeHetznerHttpClient({ base, token: Redacted.make("secret-token"), baseUrl: "https://fixture.invalid" })
  const response = await Effect.runPromise(client.execute(HttpClientRequest.get("/zones/example.com")))
  assert.strictEqual(response.status, 503)
  assert.strictEqual(calls, 6) // 1 initial + 5 retries
}, 10_000)
