import { Effect } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import { AuthenticationFailed, QuotaExceeded, ResourceConflict, ResourceNotFound } from "@kumulo/core"
import type { MksError } from "@kumulo/core"

interface ErrorContext {
  readonly kind: string
  readonly ref: string
}

// Status → tagged-error constructor, keyed by code (no switch, per
// project lint rule). Anything not listed here falls through to the
// `_fallback` case below.
const _authFailed = (ctx: ErrorContext): MksError =>
  new AuthenticationFailed({ hint: `${ctx.kind} ${ctx.ref}: OVH rejected the request credentials` })

// kumulo: OVH's error body doesn't reliably carry the numeric quota
// limit/requested pair for a generic 402/429 — `0`/`0` is a placeholder;
// tighten if a caller needs real numbers here too.
const _quotaExceeded = (ctx: ErrorContext): MksError => new QuotaExceeded({ resource: ctx.kind, limit: 0, requested: 0 })

const _byStatus: Record<number, (ctx: ErrorContext) => MksError> = {
  401: _authFailed,
  403: _authFailed,
  404: (ctx) => new ResourceNotFound(ctx),
  409: (ctx) => new ResourceConflict(ctx),
  402: _quotaExceeded,
  429: _quotaExceeded
}

// ponytail: no status code in `MksError`'s union maps cleanly onto
// transport/decode failures (bad JSON, DNS, timeouts) — fall back to
// `ResourceConflict` describing the raw failure. Revisit if a caller needs
// to distinguish "OVH said no" from "the network broke".
const _fallback = (ctx: ErrorContext): MksError => new ResourceConflict(ctx)

const _statusOf = (cause: HttpClientError.HttpClientError | SchemaError): number | undefined =>
  HttpClientError.isHttpClientError(cause) ? cause.response?.status : undefined

/** Maps a generated-client failure (`HttpClientError | SchemaError`) onto the `MksError` union. */
export const toMksError = (
  { cause, ctx }: { readonly cause: HttpClientError.HttpClientError | SchemaError; readonly ctx: ErrorContext }
): MksError => {
  const status = _statusOf(cause)
  const mapped = status === undefined ? undefined : _byStatus[status]
  return mapped ? mapped(ctx) : _fallback(ctx)
}

export const mapMksError = <A, R>(
  { self, ctx }: { readonly self: Effect.Effect<A, HttpClientError.HttpClientError | SchemaError, R>; readonly ctx: ErrorContext }
): Effect.Effect<A, MksError, R> => Effect.mapError(self, (cause) => toMksError({ cause, ctx }))
