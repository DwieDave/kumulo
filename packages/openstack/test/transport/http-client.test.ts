import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { KeystoneAuth } from "../../src/auth/keystone-auth.ts"
import { makeOpenStackHttpClient, NOVA_API_MICROVERSION } from "../../src/transport/http-client.ts"

interface FakeAuthState {
  token: string
  invalidateCalls: number
}

const _fakeAuth = (initialToken: string): { layer: Layer.Layer<KeystoneAuth>; state: FakeAuthState } => {
  const state: FakeAuthState = { token: initialToken, invalidateCalls: 0 }
  const layer = Layer.succeed(KeystoneAuth, {
    token: Effect.sync(() => state.token),
    invalidate: Effect.sync(() => {
      state.invalidateCalls += 1
      state.token = `${initialToken}-refreshed`
    }),
    endpoint: () => Effect.die("not needed in transport tests")
  })
  return { layer, state }
}

const _fakeBase = (
  handler: (request: HttpClientRequest.HttpClientRequest, call: number) => Response
): { client: HttpClient.HttpClient; requests: () => Array<HttpClientRequest.HttpClientRequest> } => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = []
  const client = HttpClient.make((request) => {
    requests.push(request)
    return Effect.succeed(HttpClientResponse.fromWeb(request, handler(request, requests.length)))
  })
  return { client, requests: () => requests }
}

describe("makeOpenStackHttpClient", () => {
  it.effect("injects X-Auth-Token and the Nova microversion header on every request", () => {
    const base = _fakeBase(() => new Response("ok", { status: 200 }))
    const auth = _fakeAuth("tok-1")
    return Effect.gen(function*() {
      const client = yield* makeOpenStackHttpClient({ base: base.client })
      yield* client.execute(HttpClientRequest.get("https://nova.example.com/servers"))
      const [request] = base.requests()
      expect(request?.headers["x-auth-token"]).toBe("tok-1")
      expect(request?.headers["x-openstack-nova-api-version"]).toBe(NOVA_API_MICROVERSION)
    }).pipe(Effect.provide(auth.layer))
  })

  // kumulo: real backoff delays elapse here — @effect/vitest's it.effect runs
  // under a virtual TestClock that never auto-advances, so timing-dependent
  // cases use plain it()/runPromise against the real clock instead.
  it("retries transient 500s with backoff until success", async () => {
    const base = _fakeBase((_r, call) => call < 3 ? new Response("boom", { status: 500 }) : new Response("ok", { status: 200 }))
    const auth = _fakeAuth("tok-1")
    const response = await Effect.runPromise(
      Effect.gen(function*() {
        const client = yield* makeOpenStackHttpClient({ base: base.client })
        return yield* client.execute(HttpClientRequest.get("https://nova.example.com/servers"))
      }).pipe(Effect.provide(auth.layer))
    )
    expect(response.status).toBe(200)
    expect(base.requests().length).toBe(3)
  }, 10_000)

  it.effect("does not retry a plain 404", () => {
    const base = _fakeBase(() => new Response("nope", { status: 404 }))
    const auth = _fakeAuth("tok-1")
    return Effect.gen(function*() {
      const client = yield* makeOpenStackHttpClient({ base: base.client })
      const response = yield* client.execute(HttpClientRequest.get("https://nova.example.com/servers"))
      expect(response.status).toBe(404)
      expect(base.requests().length).toBe(1)
    }).pipe(Effect.provide(auth.layer))
  })

  it.effect("re-authenticates once on a 401 and retries with the refreshed token", () => {
    const base = _fakeBase((_r, call) => call === 1 ? new Response("unauthorized", { status: 401 }) : new Response("ok", { status: 200 }))
    const auth = _fakeAuth("tok-1")
    return Effect.gen(function*() {
      const client = yield* makeOpenStackHttpClient({ base: base.client })
      const response = yield* client.execute(HttpClientRequest.get("https://nova.example.com/servers"))
      expect(response.status).toBe(200)
      expect(auth.state.invalidateCalls).toBe(1)
      expect(base.requests()[1]?.headers["x-auth-token"]).toBe("tok-1-refreshed")
    }).pipe(Effect.provide(auth.layer))
  })

  it("bounds concurrency with the configured semaphore", async () => {
    let inFlight = 0
    let maxInFlight = 0
    const auth = _fakeAuth("tok-1")
    const slowClient = HttpClient.make((request) =>
      Effect.gen(function*() {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        yield* Effect.sleep("10 millis")
        inFlight -= 1
        return HttpClientResponse.fromWeb(request, new Response("ok", { status: 200 }))
      }))
    await Effect.runPromise(
      Effect.gen(function*() {
        const client = yield* makeOpenStackHttpClient({ base: slowClient, maxConcurrentRequests: 1 })
        yield* Effect.all(
          [1, 2, 3].map(() => client.execute(HttpClientRequest.get("https://nova.example.com/servers"))),
          { concurrency: "unbounded" }
        )
      }).pipe(Effect.provide(auth.layer))
    )
    expect(maxInFlight).toBe(1)
  })
})
