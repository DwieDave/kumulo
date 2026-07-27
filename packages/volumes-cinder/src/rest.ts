import {
  AuthenticationFailed,
  HttpTransportError,
  ProviderApiError,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound
} from "@kumulo/core"
import type { ResponseDecodeError, VolumeError } from "@kumulo/core"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { CinderAuth } from "./auth.ts"

export type HttpMethod = "GET" | "POST" | "DELETE"

// kumulo: the honest error channel of this transport. Wider than core's
// `VolumeError` until that union gains the new provider tags.
export type CinderError = VolumeError | RateLimited | ProviderApiError | ResponseDecodeError | HttpTransportError

// kumulo: dispatch table instead of `switch` (repo-wide `no switch` rule).
const _methods: Record<HttpMethod, (url: string) => HttpClientRequest.HttpClientRequest> = {
  GET: HttpClientRequest.get,
  POST: HttpClientRequest.post,
  DELETE: HttpClientRequest.delete
}

// Cinder reports over-quota as a 403 whose body names the quota.
const _quotaBody = /quota|over ?limit/i

interface StatusContext {
  readonly status: number
  readonly ref: string
  readonly body: string
  readonly retryAfter?: string | undefined
}

// One tag per observed status — a 429 storm or a Cinder outage must never
// read as "bad credentials".
const _statusError = ({ body, ref, retryAfter, status }: StatusContext): CinderError => {
  if (status === 404) return new ResourceNotFound({ kind: "volume", ref })
  if (status === 409) return new ResourceConflict({ kind: "volume", ref })
  // The real limit/requested are not recoverable from Cinder's body, so they stay absent.
  if (status === 403 && _quotaBody.test(body)) return new QuotaExceeded({ resource: "volume" })
  if (status === 401 || status === 403) return new AuthenticationFailed({ hint: `volume ${ref}: HTTP ${status}` })
  if (status === 413 || status === 429) return new RateLimited({ kind: "volume", ref, retryAfter })
  return new ProviderApiError({ operation: `volume ${ref}`, status, body })
}

const _BODY_LIMIT = 512

export interface CinderRequest {
  readonly path: string
  readonly method: HttpMethod
  readonly body?: unknown
  readonly ref: string
  // kumulo: statuses to swallow as a no-op success (idempotent delete/create races).
  readonly okStatuses?: ReadonlyArray<number>
}

// kumulo: lenient decode — body handed back as `unknown`,
// callers pick the fields they need instead of asserting a strict response schema.
export const cinderRequest = (
  request: CinderRequest
): Effect.Effect<unknown, CinderError, CinderAuth | HttpClient.HttpClient> =>
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
      Effect.mapError((cause) => new HttpTransportError({ cause }))
    )
    if (request.okStatuses?.includes(response.status)) return undefined
    if (response.status < 200 || response.status >= 300) {
      const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
      return yield* Effect.fail(_statusError({
        status: response.status,
        ref: request.ref,
        body: body.slice(0, _BODY_LIMIT),
        retryAfter: response.headers["retry-after"]
      }))
    }
    if (response.status === 204) return undefined
    return yield* response.json.pipe(Effect.orElseSucceed(() => undefined))
  })
