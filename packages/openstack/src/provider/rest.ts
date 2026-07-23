import { AuthenticationFailed, QuotaExceeded, ResourceConflict, ResourceNotFound } from "@kumulo/core"
import type { CloudError } from "@kumulo/core"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { KeystoneAuth } from "../auth/keystone-auth.ts"

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"

// kumulo: dispatch table instead of `switch` (repo-wide `no switch` rule).
const _methods: Record<HttpMethod, (url: string) => HttpClientRequest.HttpClientRequest> = {
  GET: HttpClientRequest.get,
  POST: HttpClientRequest.post,
  PUT: HttpClientRequest.put,
  DELETE: HttpClientRequest.delete
}

const _statusError = (status: number, kind: string, ref: string): CloudError => {
  if (status === 404) return new ResourceNotFound({ kind, ref })
  if (status === 409) return new ResourceConflict({ kind, ref })
  if (status === 403) return new QuotaExceeded({ resource: kind, limit: 0, requested: 0 })
  return new AuthenticationFailed({ hint: `unexpected ${kind} response status ${status}` })
}

export interface RestRequest {
  readonly service: string
  readonly region: string
  readonly path: string
  readonly method: HttpMethod
  readonly body?: unknown
  readonly kind: string
  // kumulo: statuses to swallow as a no-op success (idempotent create races).
  readonly okStatuses?: ReadonlyArray<number>
}

// kumulo: lenient decode (FR-4.6) — body is handed back as `unknown`, callers
// pick the fields they need instead of asserting a strict response schema.
export const restRequest = (
  options: RestRequest
): Effect.Effect<unknown, CloudError, KeystoneAuth | HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const auth = yield* KeystoneAuth
    const client = yield* HttpClient.HttpClient
    const base = yield* auth.endpoint({ service: options.service, region: options.region }).pipe(
      Effect.mapError(() => new AuthenticationFailed({ hint: `${options.service} endpoint resolution failed` }))
    )
    const url = new URL(options.path, base.endsWith("/") ? base : `${base}/`)
    // kumulo: pass the URL as a string, not a `URL` object — `HttpClientRequest`
    // strips a `URL` object's query into a separate `urlParams` field on `.url`,
    // which would drop it from the plain string fixtures read in tests.
    const built = _methods[options.method](url.toString())
    const req = options.body === undefined ? built : HttpClientRequest.bodyJsonUnsafe(built, options.body)
    const response = yield* client.execute(req).pipe(
      Effect.mapError(() => new AuthenticationFailed({ hint: `${options.kind} request failed to send` }))
    )
    if (options.okStatuses?.includes(response.status)) return undefined
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(_statusError(response.status, options.kind, options.path))
    }
    if (response.status === 204) return undefined
    return yield* response.json.pipe(Effect.orElseSucceed(() => undefined))
  })

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

export const field = ({ key, value }: { readonly value: unknown; readonly key: string }): unknown =>
  isRecord(value) ? value[key] : undefined

export const asArray = (value: unknown): ReadonlyArray<unknown> => Array.isArray(value) ? value : []
