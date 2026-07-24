import { AuthenticationFailed, type ResourceNotFound } from "@kumulo/core"
import { Context, Effect, Layer, Option, Ref } from "effect"
import { Headers, HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as Schema from "effect/Schema"
import type { OpenStackCredentials } from "./credentials.ts"
import { parseCatalog, resolveEndpoint, type ServiceCatalog } from "./service-catalog.ts"

export interface EndpointOptions {
  readonly service: string
  readonly region: string
}

export class KeystoneAuth extends Context.Service<KeystoneAuth, {
  readonly token: Effect.Effect<string, AuthenticationFailed>
  readonly invalidate: Effect.Effect<void>
  readonly endpoint: (options: EndpointOptions) => Effect.Effect<string, ResourceNotFound | AuthenticationFailed>
}>()("@kumulo/openstack/KeystoneAuth") {}

interface CachedToken {
  readonly token: string
  readonly expiresAtMs: number
  readonly catalog: ServiceCatalog
}

// kumulo: only the one field this layer reads out of the token envelope —
// a missing/malformed `expires_at` is not a hard failure, it just
// falls back to "expires now" (see `_expiresAtMs` below), same as before.
const _ExpiresAt = Schema.Struct({
  token: Schema.Struct({
    expires_at: Schema.optionalKey(Schema.String)
  })
})

// kumulo: Keystone's identity/scope request shape per credential method —
// mechanical translation only, no judgment calls.
const _authBody = (credentials: OpenStackCredentials): unknown =>
  credentials.method === "application_credential"
    ? {
      auth: {
        identity: {
          methods: ["application_credential"],
          application_credential: {
            id: credentials.applicationCredentialId,
            secret: credentials.applicationCredentialSecret
          }
        }
      }
    }
    : {
      auth: {
        identity: {
          methods: ["password"],
          password: {
            user: {
              name: credentials.username,
              domain: { name: credentials.userDomain },
              password: credentials.password
            }
          }
        },
        scope: {
          project: {
            name: credentials.projectName,
            domain: { name: credentials.projectDomain }
          }
        }
      }
    }

const _authFailed = (hint: string) => new AuthenticationFailed({ hint })

const _expiresAtMs = (body: unknown): number => {
  const decoded = Schema.decodeUnknownOption(_ExpiresAt)(body)
  const raw = Option.isSome(decoded) ? decoded.value.token.expires_at : undefined
  const parsed = raw === undefined ? NaN : Date.parse(raw)
  return Number.isNaN(parsed) ? Date.now() : parsed
}

const _issueToken = (options: {
  readonly client: HttpClient.HttpClient
  readonly credentials: OpenStackCredentials
  readonly skewMs: number
}): Effect.Effect<CachedToken, AuthenticationFailed> =>
  Effect.gen(function*() {
    const url = new URL("v3/auth/tokens", options.credentials.authUrl)
    const request = HttpClientRequest.bodyJsonUnsafe(HttpClientRequest.post(url), _authBody(options.credentials))
    const response = yield* options.client.execute(request).pipe(
      Effect.mapError(() => _authFailed("keystone token request failed to send"))
    )
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(_authFailed(`keystone token issue failed with status ${response.status}`))
    }
    const token = Option.getOrUndefined(Headers.get(response.headers, "x-subject-token"))
    if (token === undefined) {
      return yield* Effect.fail(_authFailed("keystone response missing X-Subject-Token header"))
    }
    const body = yield* response.json.pipe(Effect.mapError(() => _authFailed("keystone response body was not JSON")))
    const catalog = yield* parseCatalog(body).pipe(
      Effect.mapError(() => _authFailed("keystone response catalog was malformed"))
    )
    return { token, expiresAtMs: _expiresAtMs(body) - options.skewMs, catalog }
  })

export interface KeystoneAuthLiveOptions {
  readonly credentials: OpenStackCredentials
  readonly skewMs?: number
}

// kumulo: token cache with expiry skew — a fresh token is only
// issued once per skew window, every other caller shares the cached result.
export const KeystoneAuthLive = (
  options: KeystoneAuthLiveOptions
): Layer.Layer<KeystoneAuth, never, HttpClient.HttpClient> =>
  Layer.effect(
    KeystoneAuth,
    Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient
      const skewMs = options.skewMs ?? 60_000
      const cache = yield* Ref.make<Option.Option<CachedToken>>(Option.none())

      const refresh = _issueToken({ client, credentials: options.credentials, skewMs }).pipe(
        Effect.tap((cached) => Ref.set(cache, Option.some(cached)))
      )

      const current: Effect.Effect<CachedToken, AuthenticationFailed> = Effect.gen(function*() {
        // kumulo: real wall-clock time — token expiry is a real-world concept
        // that must not be virtualized by Effect's TestClock in tests.
        const now = Date.now()
        const cached = yield* Ref.get(cache)
        if (Option.isSome(cached) && cached.value.expiresAtMs > now) return cached.value
        return yield* refresh
      })

      return {
        token: Effect.map(current, (cached) => cached.token),
        invalidate: Ref.set(cache, Option.none()),
        endpoint: (endpointOptions) =>
          Effect.flatMap(current, (cached) =>
            resolveEndpoint({
              catalog: cached.catalog,
              service: endpointOptions.service,
              region: endpointOptions.region
            }))
      }
    })
  )
