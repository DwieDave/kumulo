import { Duration, Effect, Redacted } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { BunnyHttpLive, makeBunnyHttpClient, parseRetryAfter } from "../../src/transport/http-client.ts"

const _rawHttpClient = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request))))

const _options = (base: HttpClient.HttpClient) => ({ base, apiKey: Redacted.make("secret-key"), baseUrl: "https://fixture.invalid" })

it.effect("sends the AccessKey header and prepends the base URL", () =>
  Effect.gen(function*() {
    let captured: { readonly url: string; readonly key: string | undefined } | undefined

    const base = _rawHttpClient((request) => {
      captured = { url: request.url, key: request.headers.accesskey }

      return new Response(null, { status: 200 })
    })

    yield* makeBunnyHttpClient(_options(base)).execute(HttpClientRequest.get("/dnszone"))
    assert.strictEqual(captured?.url, "https://fixture.invalid/dnszone")
    assert.strictEqual(captured?.key, "secret-key")
  }))

it.effect("leaves an absolute URL from a wrapped client untouched and still authenticates it", () =>
  Effect.gen(function*() {
    let captured: { readonly url: string; readonly key: string | undefined } | undefined

    const base = _rawHttpClient((request) => {
      captured = { url: request.url, key: request.headers.accesskey }

      return new Response(null, { status: 200 })
    }).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl("https://other.invalid")))

    yield* makeBunnyHttpClient(_options(base)).execute(HttpClientRequest.get("/dnszone"))
    assert.strictEqual(captured?.url, "https://other.invalid/dnszone")
    assert.strictEqual(captured?.key, "secret-key")
  }))

it.effect("defaults to the public bunny.net API for both Core and Shield paths", () =>
  Effect.gen(function*() {
    const urls: Array<string> = []

    const base = _rawHttpClient((request) => {
      urls.push(request.url)

      return new Response(null, { status: 200 })
    })

    const client = makeBunnyHttpClient({ base, apiKey: Redacted.make("k") })
    yield* client.execute(HttpClientRequest.get("/dnszone"))
    yield* client.execute(HttpClientRequest.get("/shield/shield-zone"))
    assert.deepStrictEqual(urls, ["https://api.bunny.net/dnszone", "https://api.bunny.net/shield/shield-zone"])
  }))

it.effect("BunnyHttpLive wraps the provided client", () =>
  Effect.gen(function*() {
    let key: string | undefined

    const base = _rawHttpClient((request) => {
      key = request.headers.accesskey

      return new Response(null, { status: 200 })
    })

    const program = Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient

      return yield* client.execute(HttpClientRequest.get("/dnszone"))
    }).pipe(
      Effect.provide(BunnyHttpLive({ apiKey: Redacted.make("live-key"), baseUrl: "https://fixture.invalid" })),
      Effect.provideService(HttpClient.HttpClient, base)
    )

    const response = yield* program
    assert.strictEqual(response.status, 200)
    assert.strictEqual(key, "live-key")
  }))

it.effect("does not retry a non-retryable 4xx", () =>
  Effect.gen(function*() {
    let calls = 0

    const base = _rawHttpClient(() => {
      calls++

      return new Response(null, { status: 404 })
    })

    const response = yield* makeBunnyHttpClient(_options(base)).execute(HttpClientRequest.get("/dnszone/1"))
    assert.strictEqual(response.status, 404)
    assert.strictEqual(calls, 1)
  }))

it("retries on 429 and eventually succeeds", async () => {
  let calls = 0

  const base = _rawHttpClient(() => {
    calls++

    return new Response(null, { status: calls < 3 ? 429 : 200 })
  })

  const response = await Effect.runPromise(makeBunnyHttpClient(_options(base)).execute(HttpClientRequest.get("/dnszone")))
  assert.strictEqual(response.status, 200)
  assert.strictEqual(calls, 3)
}, 10_000)

it("retries on 5xx and eventually succeeds", async () => {
  let calls = 0

  const base = _rawHttpClient(() => {
    calls++

    return new Response(null, { status: calls < 2 ? 502 : 200 })
  })

  const response = await Effect.runPromise(makeBunnyHttpClient(_options(base)).execute(HttpClientRequest.get("/dnszone")))
  assert.strictEqual(response.status, 200)
  assert.strictEqual(calls, 2)
}, 10_000)

it("gives up after the max retry bound on a persistent 5xx", async () => {
  let calls = 0

  const base = _rawHttpClient(() => {
    calls++

    return new Response(null, { status: 503 })
  })

  const response = await Effect.runPromise(makeBunnyHttpClient(_options(base)).execute(HttpClientRequest.get("/dnszone")))
  assert.strictEqual(response.status, 503)
  assert.strictEqual(calls, 6)
}, 10_000)

it("does not retry a 503 on a PUT", async () => {
  let calls = 0

  const base = _rawHttpClient(() => {
    calls++

    return new Response(null, { status: 503 })
  })

  const response = await Effect.runPromise(makeBunnyHttpClient(_options(base)).execute(HttpClientRequest.put("/dnszone/1/records")))
  assert.strictEqual(response.status, 503)
  assert.strictEqual(calls, 1)
})

it("retries a POST on 429 and honours Retry-After", async () => {
  let calls = 0

  const base = _rawHttpClient(() => {
    calls++

    return calls < 2 ? new Response(null, { status: 429, headers: { "retry-after": "0" } }) : new Response(null, { status: 200 })
  })

  const response = await Effect.runPromise(makeBunnyHttpClient(_options(base)).execute(HttpClientRequest.post("/pullzone")))
  assert.strictEqual(response.status, 200)
  assert.strictEqual(calls, 2)
})

it("parses Retry-After seconds and rejects garbage", () => {
  assert.strictEqual(Duration.toMillis(Duration.fromInputUnsafe(parseRetryAfter("2") ?? 0)), 2000)
  assert.isUndefined(parseRetryAfter("soon"))
  assert.isUndefined(parseRetryAfter(undefined))
})
