import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import type { HttpClientRequest } from "effect/unstable/http"
import { KeystoneAuth, KeystoneAuthLive } from "../../src/auth/keystone-auth.ts"
import type { ApplicationCredentialAuth } from "../../src/auth/credentials.ts"

const credentials: ApplicationCredentialAuth = {
  method: "application_credential",
  authUrl: "https://keystone.example.com/v3/",
  applicationCredentialId: "app-id",
  applicationCredentialSecret: "app-secret",
  region: "gra"
}

const _tokenBody = (expiresAt: string) => ({
  token: {
    expires_at: expiresAt,
    catalog: [
      {
        type: "compute",
        endpoints: [{ interface: "public", region: "gra", url: "https://nova.gra.example.com" }]
      }
    ]
  }
})

const _okResponse = (expiresAt: string) =>
  new Response(JSON.stringify(_tokenBody(expiresAt)), {
    status: 201,
    headers: { "x-subject-token": "secret-token", "content-type": "application/json" }
  })

interface FakeClient {
  readonly client: HttpClient.HttpClient
  readonly callCount: () => number
}

const _fakeKeystone = (handler: (request: HttpClientRequest.HttpClientRequest, call: number) => Response): FakeClient => {
  let calls = 0
  const client = HttpClient.make((request) => {
    calls += 1
    return Effect.succeed(HttpClientResponse.fromWeb(request, handler(request, calls)))
  })
  return { client, callCount: () => calls }
}

const _layerFor = (fake: FakeClient, skewMs?: number) =>
  Layer.provide(KeystoneAuthLive({ credentials, skewMs }), Layer.succeed(HttpClient.HttpClient, fake.client))

const _jsonBody = (request: HttpClientRequest.HttpClientRequest): unknown =>
  request.body._tag === "Uint8Array" ? JSON.parse(new TextDecoder().decode(request.body.body)) : undefined

describe("KeystoneAuthLive", () => {
  // kumulo: WHY this test — the spec omits `required` on the token requestBody,
  // so the generator emitted `payload: [NoContent, ...Json]` and the encoder
  // matched the empty branch: the token request went out with NO BODY and real
  // Keystone answered 400. Every fake here only ever checked the response, so
  // nothing caught it until the first live `apply`. Assert the wire body.
  it.effect("sends the application-credential body, not an empty request", () => {
    const farFuture = new Date(Date.now() + 3_600_000).toISOString()
    let sent: unknown = undefined
    const fake = _fakeKeystone((request) => {
      sent = _jsonBody(request)
      return _okResponse(farFuture)
    })
    return Effect.gen(function*() {
      yield* (yield* KeystoneAuth).token
      expect(sent).toEqual({
        auth: {
          identity: {
            methods: ["application_credential"],
            application_credential: { id: "app-id", secret: "app-secret" }
          }
        }
      })
    }).pipe(Effect.provide(_layerFor(fake)))
  })

  it.effect("issues a token once and reuses it while valid", () => {
    const farFuture = new Date(Date.now() + 3_600_000).toISOString()
    const fake = _fakeKeystone(() => _okResponse(farFuture))
    return Effect.gen(function*() {
      const auth = yield* KeystoneAuth
      const first = yield* auth.token
      const second = yield* auth.token
      expect(first).toBe("secret-token")
      expect(second).toBe("secret-token")
      expect(fake.callCount()).toBe(1)
    }).pipe(Effect.provide(_layerFor(fake)))
  })

  it.effect("re-issues once expired past the skew window", () => {
    // expires 30s from now, but a 60s skew pushes it into the past immediately
    const soon = new Date(Date.now() + 30_000).toISOString()
    const fake = _fakeKeystone(() => _okResponse(soon))
    return Effect.gen(function*() {
      const auth = yield* KeystoneAuth
      yield* auth.token
      yield* auth.token
      expect(fake.callCount()).toBe(2)
    }).pipe(Effect.provide(_layerFor(fake, 60_000)))
  })

  it.effect("invalidate forces a re-issue on the next token request", () => {
    const farFuture = new Date(Date.now() + 3_600_000).toISOString()
    const fake = _fakeKeystone(() => _okResponse(farFuture))
    return Effect.gen(function*() {
      const auth = yield* KeystoneAuth
      yield* auth.token
      yield* auth.invalidate
      yield* auth.token
      expect(fake.callCount()).toBe(2)
    }).pipe(Effect.provide(_layerFor(fake)))
  })

  it.effect("resolves a service-catalog endpoint by service and region", () => {
    const farFuture = new Date(Date.now() + 3_600_000).toISOString()
    const fake = _fakeKeystone(() => _okResponse(farFuture))
    return Effect.gen(function*() {
      const auth = yield* KeystoneAuth
      const url = yield* auth.endpoint({ service: "compute", region: "gra" })
      expect(url).toBe("https://nova.gra.example.com")
    }).pipe(Effect.provide(_layerFor(fake)))
  })

  it("fails with AuthenticationFailed when keystone returns a non-2xx status", async () => {
    const fake = _fakeKeystone(() => new Response("nope", { status: 401 }))
    const program = Effect.gen(function*() {
      const auth = yield* KeystoneAuth
      return yield* auth.token
    }).pipe(Effect.provide(_layerFor(fake)))
    const exit = await Effect.runPromiseExit(program)
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
