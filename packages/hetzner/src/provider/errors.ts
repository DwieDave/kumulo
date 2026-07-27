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

/**
 * Exactly the tags this package can actually raise — a subset of both
 * `CloudError` and `VolumeError`, so neither port needs a narrowing step.
 */
export type HcloudError =
  | AuthenticationFailed
  | QuotaExceeded
  | RateLimited
  | ProviderApiError
  | ResourceNotFound
  | ResourceConflict
  | ResponseDecodeError
  | HttpTransportError

/** Failure channel of every generated-client operation. */
export type HcloudCause = HttpClientError.HttpClientError | SchemaError

export interface ErrorContext {
  readonly kind: string
  readonly ref: string
}

const _op = (ctx: ErrorContext): string => `${ctx.kind} ${ctx.ref}`

interface Classified extends ErrorContext {
  readonly status: number
  readonly body: string
  readonly retryAfter: string | undefined
}

// hcloud reports a genuine quota exhaustion with a machine-readable `code` in
// the error body (a plain 403 without it is a credential problem, and a 422
// without it is bad input) — `QuotaExceeded` is raised only on that signal,
// and without the fabricated `limit`/`requested` zeroes it used to carry.
const _QUOTA_CODES = ["resource_limit_exceeded", "quota_exceeded"]
const _isQuota = (body: string): boolean => _QUOTA_CODES.some((code) => body.includes(code))

// Status -> tagged error, keyed by code (no `switch`, per project lint rule).
// 423 (`locked`/`protected`) is Hetzner's "an Action is already running on
// this resource", i.e. a conflict. Anything unlisted — notably 422 (validation)
// and every 5xx — falls through to `ProviderApiError`, which carries the real
// status and body instead of guessing.
const _byStatus: Record<number, (c: Classified) => HcloudError> = {
  401: (c) => new AuthenticationFailed({ hint: `${_op(c)}: hcloud rejected the API token` }),
  403: (c) => new AuthenticationFailed({ hint: `${_op(c)}: hcloud API token lacks permission` }),
  404: (c) => new ResourceNotFound({ kind: c.kind, ref: c.ref }),
  409: (c) => new ResourceConflict({ kind: c.kind, ref: c.ref }),
  423: (c) => new ResourceConflict({ kind: c.kind, ref: c.ref }),
  429: (c) => new RateLimited({ kind: c.kind, ref: c.ref, retryAfter: c.retryAfter })
}

const _classify = (c: Classified): HcloudError => {
  if (_isQuota(c.body)) return new QuotaExceeded({ resource: c.kind })
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

/** Maps a generated-client failure (`HttpClientError | SchemaError`) onto `HcloudError`. */
export const toHcloudError = (
  { cause, ctx }: { readonly cause: HcloudCause; readonly ctx: ErrorContext }
): Effect.Effect<HcloudError> => {
  if (!HttpClientError.isHttpClientError(cause)) {
    return Effect.succeed(new ResponseDecodeError({ endpoint: _op(ctx), issue: cause.issue }))
  }
  const response = cause.response
  if (response === undefined) return Effect.succeed(new HttpTransportError({ cause }))
  return Effect.map(
    _bodyText(response),
    (body) => _classify({ ...ctx, status: response.status, body, retryAfter: _retryAfter(response) })
  )
}

export const mapHcloudError = <A, R>(
  { self, ctx }: { readonly self: Effect.Effect<A, HcloudCause, R>; readonly ctx: ErrorContext }
): Effect.Effect<A, HcloudError, R> =>
  Effect.catch(self, (cause) => Effect.flatMap(toHcloudError({ cause, ctx }), Effect.fail))

/** Several hcloud create/get payloads mark their sole resource field optional. */
export const required = <A>(
  { kind, ref, value }: { readonly value: A | undefined; readonly kind: string; readonly ref: string }
): Effect.Effect<A, ResourceNotFound> =>
  value === undefined ? Effect.fail(new ResourceNotFound({ kind, ref })) : Effect.succeed(value)

/** Deleting an already-gone resource is a success, not a failure. */
export const ignoreMissing = <A, R>(self: Effect.Effect<A, HcloudError, R>): Effect.Effect<void, HcloudError, R> =>
  Effect.asVoid(Effect.catchTag(self, "ResourceNotFound", () => Effect.void))
