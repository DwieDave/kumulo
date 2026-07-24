import { AuthenticationFailed, QuotaExceeded, ResourceConflict, ResourceNotFound } from "@kumulo/core"
import type { CloudError } from "@kumulo/core"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { HCLOUD_API_BASE_URL } from "../auth/client.ts"

export type HttpMethod = "GET" | "POST" | "DELETE"

// kumulo: dispatch table instead of `switch` (repo-wide `no switch` rule).
const _methods: Record<HttpMethod, (url: string) => HttpClientRequest.HttpClientRequest> = {
  GET: HttpClientRequest.get,
  POST: HttpClientRequest.post,
  DELETE: HttpClientRequest.delete
}

// kumulo: status -> error mapping per the spec's own documented error-code
// table (`specs/hcloud/cloud.spec.json`'s Errors section) — 423 (`locked`/
// `protected`) is Hetzner's "an Action is already running on this resource"
// conflict, folded into `ResourceConflict` alongside 409.
const _statusError = (status: number, kind: string, ref: string): CloudError => {
  if (status === 404) return new ResourceNotFound({ kind, ref })
  if (status === 409 || status === 423) return new ResourceConflict({ kind, ref })
  if (status === 403 || status === 422 || status === 429) return new QuotaExceeded({ resource: kind, limit: 0, requested: 0 })
  return new AuthenticationFailed({ hint: `unexpected ${kind} response status ${status}` })
}

export interface HcloudRequest {
  readonly path: string
  readonly method: HttpMethod
  readonly body?: unknown
  readonly kind: string
  // kumulo: statuses to swallow as a no-op success (idempotent create/delete races).
  readonly okStatuses?: ReadonlyArray<number>
}

// kumulo: lenient decode — body is handed back as `unknown`, callers pick the
// fields they need (mirrors openstack's `restRequest`, minus the Keystone
// service-catalog lookup — hcloud is one flat API with one base URL). Builds
// the absolute URL itself (like openstack's `restRequest` does via its own
// `new URL(path, base)`) rather than relying on a wrapping Layer's
// `prependUrl` — `HttpClient.make`-based clients (real or fake) validate
// `request.url` as absolute *before* any request-transforming wrapper gets a
// chance to fix up a relative one.
export const hcloudRequest = (options: HcloudRequest): Effect.Effect<unknown, CloudError, HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const url = new URL(options.path, `${HCLOUD_API_BASE_URL}/`).toString()
    const built = _methods[options.method](url)
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
