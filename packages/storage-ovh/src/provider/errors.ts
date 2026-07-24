import { Effect } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import {
  AuthenticationFailed,
  HttpTransportError,
  QuotaExceeded,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "@kumulo/core"
import type { ObjectStorageError } from "@kumulo/core"

interface ErrorContext {
  readonly kind: string
  readonly ref: string
}

// Status → tagged-error constructor, keyed by code (no switch, per
// project lint rule). Anything not listed here falls through to the
// `_fallback` case below.
const _authFailed = (ctx: ErrorContext): ObjectStorageError =>
  new AuthenticationFailed({ hint: `${ctx.kind} ${ctx.ref}: OVH rejected the request credentials` })

// kumulo: OVH's error body doesn't reliably carry the numeric quota
// limit/requested pair for a generic 402/429 — `0`/`0` is a placeholder;
// tighten if a caller needs real numbers here too.
const _quotaExceeded = (ctx: ErrorContext): ObjectStorageError => new QuotaExceeded({ resource: ctx.kind, limit: 0, requested: 0 })

const _byStatus: Record<number, (ctx: ErrorContext) => ObjectStorageError> = {
  401: _authFailed,
  403: _authFailed,
  404: (ctx) => new ResourceNotFound(ctx),
  409: (ctx) => new ResourceConflict(ctx),
  402: _quotaExceeded,
  429: _quotaExceeded
}

// Anything without a mapped status keeps its full cause: decode failures
// carry the schema issue tree, everything else (unexpected statuses,
// network/TLS) the raw HttpClientError — no more collapsing into a fake
// "conflict".
const _fallback = (cause: HttpClientError.HttpClientError | SchemaError, ctx: ErrorContext): ObjectStorageError =>
  HttpClientError.isHttpClientError(cause)
    ? new HttpTransportError({ cause })
    : new ResponseDecodeError({ endpoint: `${ctx.kind}/${ctx.ref}`, issue: cause.issue })

const _statusOf = (cause: HttpClientError.HttpClientError | SchemaError): number | undefined =>
  HttpClientError.isHttpClientError(cause) ? cause.response?.status : undefined

/** Maps a generated-client failure (`HttpClientError | SchemaError`) onto the `ObjectStorageError` union. */
export const toStorageError = (
  { cause, ctx }: { readonly cause: HttpClientError.HttpClientError | SchemaError; readonly ctx: ErrorContext }
): ObjectStorageError => {
  const status = _statusOf(cause)
  const mapped = status === undefined ? undefined : _byStatus[status]
  return mapped ? mapped(ctx) : _fallback(cause, ctx)
}

export const mapStorageError = <A, R>(
  { self, ctx }: { readonly self: Effect.Effect<A, HttpClientError.HttpClientError | SchemaError, R>; readonly ctx: ErrorContext }
): Effect.Effect<A, ObjectStorageError, R> => Effect.mapError(self, (cause) => toStorageError({ cause, ctx }))
