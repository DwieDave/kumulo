/**
 * HTTP status -> core tagged error (R5). UpCloud's exact 4xx error body shape
 * is an open question (plan.md Q8, needs a live probe) — until then, quota
 * detection is status-only (402, per R5) rather than body-sniffed the way
 * hcloud's `_isQuota` inspects a machine-readable error code.
 */
import { Effect } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
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

/** Exactly the tags this package can raise (R5). */
export type UpcloudError =
  | AuthenticationFailed
  | QuotaExceeded
  | RateLimited
  | ProviderApiError
  | ResourceNotFound
  | ResourceConflict
  | ResponseDecodeError
  | HttpTransportError

/** Failure channel of every client operation before mapping. */
export type UpcloudCause = HttpClientError.HttpClientError | SchemaError

export interface ErrorContext {
  readonly kind: string
  readonly ref: string
}

const _op = (ctx: ErrorContext): string => `${ctx.kind} ${ctx.ref}`

export interface Classified extends ErrorContext {
  readonly status: number
  readonly body: string
  readonly retryAfter: string | undefined
}

// Status -> tagged error, keyed by code (no `switch`, per project lint rule).
// 402 is UpCloud's payment-required signal, used here for quota exhaustion
// (R5); anything unlisted — every other 4xx and every 5xx — falls through to
// `ProviderApiError`, which carries the real status and body instead of
// guessing.
const _byStatus: Record<number, (c: Classified) => UpcloudError> = {
  401: (c) => new AuthenticationFailed({ hint: `${_op(c)}: UpCloud rejected the API token` }),
  402: (c) => new QuotaExceeded({ resource: c.kind }),
  403: (c) => new AuthenticationFailed({ hint: `${_op(c)}: UpCloud API token lacks permission` }),
  404: (c) => new ResourceNotFound({ kind: c.kind, ref: c.ref }),
  409: (c) => new ResourceConflict({ kind: c.kind, ref: c.ref }),
  429: (c) => new RateLimited({ kind: c.kind, ref: c.ref, retryAfter: c.retryAfter })
}

/** Maps a classified HTTP status onto its tagged error — pure, total over the whole status space. */
export const statusError = (c: Classified): UpcloudError => {
  const mapped = _byStatus[c.status]
  return mapped === undefined
    ? new ProviderApiError({ operation: _op(c), status: c.status, body: c.body.slice(0, 512) })
    : mapped(c)
}

// `Retry-After` (relative seconds) is preferred over `RateLimit-Reset` (an
// absolute UNIX timestamp) — both are passed through verbatim, undecorated.
const _retryAfter = (response: HttpClientResponse.HttpClientResponse): string | undefined =>
  response.headers["retry-after"] ?? response.headers["ratelimit-reset"]

const _bodyText = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<string> =>
  Effect.orElseSucceed(response.text, () => "")

/** Maps a client-call failure (`HttpClientError | SchemaError`) onto `UpcloudError` (R5). */
export const toUpcloudError = (
  { cause, ctx }: { readonly cause: UpcloudCause; readonly ctx: ErrorContext }
): Effect.Effect<UpcloudError> => {
  if (!HttpClientError.isHttpClientError(cause)) {
    return Effect.succeed(new ResponseDecodeError({ endpoint: _op(ctx), issue: cause.issue }))
  }
  const response = cause.response
  if (response === undefined) return Effect.succeed(new HttpTransportError({ cause }))
  return Effect.map(
    _bodyText(response),
    (body) => statusError({ ...ctx, status: response.status, body, retryAfter: _retryAfter(response) })
  )
}

/** Maps every failure of `self` (`HttpClientError | SchemaError`) onto `UpcloudError` (R5). */
export const mapUpcloudError = <A, R>(
  { self, ctx }: { readonly self: Effect.Effect<A, UpcloudCause, R>; readonly ctx: ErrorContext }
): Effect.Effect<A, UpcloudError, R> =>
  Effect.catch(self, (cause) => Effect.flatMap(toUpcloudError({ cause, ctx }), Effect.fail))

/** Deleting an already-gone resource is a success, not a failure. */
export const ignoreMissing = <A, R>(self: Effect.Effect<A, UpcloudError, R>): Effect.Effect<void, UpcloudError, R> =>
  Effect.asVoid(Effect.catchTag(self, "ResourceNotFound", () => Effect.void))
