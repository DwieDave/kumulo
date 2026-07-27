import {
  AuthenticationFailed,
  HttpTransportError,
  ProviderApiError,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "@kumulo/core"
import type { CloudError } from "@kumulo/core"
import { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/unstable/http/HttpClientError"

// kumulo: the honest error channel of the generated clients. Wider than core's
// `CloudError` because a provider outage and a rate limit are not cloud-model
// failures — see `@kumulo/core`'s ports.
export type OpenStackError = CloudError | RateLimited | ProviderApiError | ResponseDecodeError | HttpTransportError

export interface StatusContext {
  readonly status: number
  readonly kind: string
  readonly ref: string
  /** Response body, already truncated. Empty string when unreadable. */
  readonly body: string
  /** `Retry-After` header verbatim, when the server sent one. */
  readonly retryAfter?: string | undefined
}

// OpenStack reports over-quota as a 403 whose body names the quota.
const _quotaBody = /quota|over ?limit/i

const _detail = ({ body, retryAfter, status }: StatusContext): string =>
  `HTTP ${status}${retryAfter === undefined ? "" : ` (retry after ${retryAfter})`}${body === "" ? "" : `: ${body}`}`

// One tag per observed status: nothing is reclassified as a credential
// problem. 401/403 → auth, 404 → not-found, 409 → conflict, 413/429 →
// rate-limited, everything else (notably 5xx) → ProviderApiError carrying the
// real status and body.
export const statusError = (context: StatusContext): OpenStackError => {
  const { body, kind, ref, retryAfter, status } = context
  if (status === 404) return new ResourceNotFound({ kind, ref })
  if (status === 409) return new ResourceConflict({ kind, ref })
  // The actual limit/requested numbers are not recoverable from the body, so
  // they stay absent rather than being fabricated.
  if (status === 403 && _quotaBody.test(body)) return new QuotaExceeded({ resource: kind })
  if (status === 401 || status === 403) return new AuthenticationFailed({ hint: `${kind} ${ref}: ${_detail(context)}` })
  if (status === 413 || status === 429) return new RateLimited({ kind, ref, retryAfter })
  return new ProviderApiError({ operation: `${kind} ${ref}`, status, body })
}

// kumulo: the non-2xx transform in `src/client/openstack.ts` parks the
// truncated response body in `reason.description`, so the quota/5xx detail
// above survives without a second body read here.
const _description = (cause: HttpClientError.HttpClientError): string =>
  "description" in cause.reason ? cause.reason.description ?? "" : ""

export interface ErrorContext {
  readonly kind: string
  readonly ref: string
}

/**
 * Maps a generated-client failure onto the `OpenStackError` union.
 *
 * `cause` is `unknown` rather than `HttpClientError | SchemaError` because each
 * endpoint's channel also carries the spec's own declared error responses —
 * `HttpApiSchema.Empty(404)`'s `void`, Keystone's 401 receipt body, and so on.
 * `failNon2xx` fails every non-2xx before any of those are decoded, so in
 * practice only the two below ever arrive; the rest are still mapped honestly
 * instead of being asserted away.
 */
export const toOpenStackError = (
  context: ErrorContext
) =>
(cause: unknown): OpenStackError => {
  if (cause instanceof SchemaError) {
    return new ResponseDecodeError({ endpoint: context.kind, issue: cause.issue })
  }
  if (!HttpClientError.isHttpClientError(cause)) {
    return new ProviderApiError({ operation: `${context.kind} ${context.ref}`, status: 0, body: String(cause) })
  }
  const response = cause.response
  // No response at all is a transport failure, not a status the provider chose.
  return response === undefined
    ? new HttpTransportError({ cause })
    : statusError({
      status: response.status,
      kind: context.kind,
      ref: context.ref,
      body: _description(cause),
      retryAfter: response.headers["retry-after"]
    })
}
