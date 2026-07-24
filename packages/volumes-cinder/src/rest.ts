import { AuthenticationFailed, QuotaExceeded, ResourceConflict, ResourceNotFound } from "@kumulo/core"
import type { VolumeError } from "@kumulo/core"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { CinderAuth } from "./auth.ts"

export type HttpMethod = "GET" | "POST" | "DELETE"

// kumulo: dispatch table instead of `switch` (repo-wide `no switch` rule).
const _methods: Record<HttpMethod, (url: string) => HttpClientRequest.HttpClientRequest> = {
  GET: HttpClientRequest.get,
  POST: HttpClientRequest.post,
  DELETE: HttpClientRequest.delete
}

const _statusError = (status: number, ref: string): VolumeError => {
  if (status === 404) return new ResourceNotFound({ kind: "volume", ref })
  if (status === 409) return new ResourceConflict({ kind: "volume", ref })
  if (status === 403) return new QuotaExceeded({ resource: "volume", limit: 0, requested: 0 })
  return new AuthenticationFailed({ hint: `unexpected volume response status ${status}` })
}

export interface CinderRequest {
  readonly path: string
  readonly method: HttpMethod
  readonly body?: unknown
  readonly ref: string
  // kumulo: statuses to swallow as a no-op success (idempotent delete/create races).
  readonly okStatuses?: ReadonlyArray<number>
}

// kumulo: lenient decode (FR-4.6 style) — body handed back as `unknown`,
// callers pick the fields they need instead of asserting a strict response schema.
export const cinderRequest = (
  request: CinderRequest
): Effect.Effect<unknown, VolumeError, CinderAuth | HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const auth = yield* CinderAuth
    const client = yield* HttpClient.HttpClient
    const base = yield* auth.endpoint
    const url = new URL(request.path, base.endsWith("/") ? base : `${base}/`)
    const built = _methods[request.method](url.toString())
    const withBody = request.body === undefined ? built : HttpClientRequest.bodyJsonUnsafe(built, request.body)
    const token = yield* auth.token
    const authed = HttpClientRequest.setHeader(withBody, "X-Auth-Token", token)
    const response = yield* client.execute(authed).pipe(
      Effect.mapError(() => new AuthenticationFailed({ hint: "volume request failed to send" }))
    )
    if (request.okStatuses?.includes(response.status)) return undefined
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(_statusError(response.status, request.ref))
    }
    if (response.status === 204) return undefined
    return yield* response.json.pipe(Effect.orElseSucceed(() => undefined))
  })
