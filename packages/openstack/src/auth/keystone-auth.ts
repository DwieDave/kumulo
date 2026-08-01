import { AuthenticationFailed } from "@kumulo/core"
import { Context, Effect, Layer, Option, Ref } from "effect"
import { Headers } from "effect/unstable/http"
import type { HttpClient } from "effect/unstable/http"
import { makeKeystoneClient } from "../client/keystone.ts"
import type { AuthTokensPostRequest } from "../generated/keystone.ts"
import { toOpenStackError } from "../provider/errors.ts"
import type { OpenStackError } from "../provider/errors.ts"
import type { OpenStackCredentials } from "./credentials.ts"
import { catalogOf, resolveEndpoint, type ServiceCatalog } from "./service-catalog.ts"

export interface EndpointOptions {
  readonly service: string
  readonly region: string
}

export class KeystoneAuth extends Context.Service<KeystoneAuth, {
  readonly token: Effect.Effect<string, OpenStackError>
  readonly invalidate: Effect.Effect<void>
  readonly endpoint: (options: EndpointOptions) => Effect.Effect<string, OpenStackError>
}>()("@kumulo/openstack/KeystoneAuth") {}

interface CachedToken {
  readonly token: string
  readonly expiresAtMs: number
  readonly catalog: ServiceCatalog
}

const _authBody = (credentials: OpenStackCredentials): AuthTokensPostRequest =>
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

const _expiresAtMs = (raw: string | undefined): number => {
  const parsed = raw === undefined ? NaN : Date.parse(raw)
  return Number.isNaN(parsed) ? Date.now() : parsed
}

// landmine: don't map every non-2xx to AuthenticationFailed — a 429/503 must not page as "bad credentials"
const _tokenRef = { kind: "keystone-token", ref: "/v3/auth/tokens" }

const _issueToken = (options: {
  readonly credentials: OpenStackCredentials
  readonly skewMs: number
}): Effect.Effect<CachedToken, OpenStackError, HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const client = yield* makeKeystoneClient(options.credentials.authUrl)
    const [body, response] = yield* client.auth.authTokensPost({
      payload: _authBody(options.credentials),
      responseMode: "decoded-and-response"
    }).pipe(Effect.mapError(toOpenStackError(_tokenRef)))
    const token = Option.getOrUndefined(Headers.get(response.headers, "x-subject-token"))
    if (token === undefined) {
      return yield* Effect.fail(new AuthenticationFailed({ hint: "keystone response missing X-Subject-Token header" }))
    }
    return {
      token,
      expiresAtMs: _expiresAtMs(body.token?.expires_at) - options.skewMs,
      catalog: catalogOf(body)
    }
  })

export interface KeystoneAuthLiveOptions {
  readonly credentials: OpenStackCredentials
  readonly skewMs?: number
}

export const KeystoneAuthLive = (
  options: KeystoneAuthLiveOptions
): Layer.Layer<KeystoneAuth, never, HttpClient.HttpClient> =>
  Layer.effect(
    KeystoneAuth,
    Effect.gen(function*() {
      const context = yield* Effect.context<HttpClient.HttpClient>()
      const skewMs = options.skewMs ?? 60_000
      const cache = yield* Ref.make<Option.Option<CachedToken>>(Option.none())

      const refresh = _issueToken({ credentials: options.credentials, skewMs }).pipe(
        Effect.provide(context),
        Effect.tap((cached) => Ref.set(cache, Option.some(cached)))
      )

      const current: Effect.Effect<CachedToken, OpenStackError> = Effect.gen(function*() {
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
