import { Effect } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
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
import type { MksError } from "@kumulo/core"

interface ErrorContext {
  readonly kind: string
  readonly ref: string
}

// OVH signals over-quota with a 402/403 whose message names the quota; the
// numeric limit/requested pair is not recoverable from that body, so those
// fields stay absent rather than being fabricated as `0`.
const _quotaMessage = /quota|over ?limit/i

const _retryAfter = (cause: HttpClientError.HttpClientError): string | undefined => cause.response?.headers["retry-after"]

// One tag per observed status — nothing is reclassified: 401/403 → auth,
// 404 → not-found, 409 → genuine conflict, 402/403 naming a quota → quota,
// 413/429 → rate-limited, everything else (notably 5xx) → ProviderApiError
// carrying the real status and body.
const _byStatus = (
  { cause, ctx, status }: {
    readonly cause: HttpClientError.HttpClientError
    readonly ctx: ErrorContext
    readonly status: number
  }
): MksError => {
  if (status === 404) return new ResourceNotFound(ctx)
  if (status === 409) return new ResourceConflict(ctx)
  if ((status === 402 || status === 403) && _quotaMessage.test(cause.message)) {
    return new QuotaExceeded({ resource: ctx.kind })
  }
  if (status === 401 || status === 403) return new AuthenticationFailed({ hint: `${ctx.kind} ${ctx.ref}: ${cause.message}` })
  if (status === 413 || status === 429) return new RateLimited({ ...ctx, retryAfter: _retryAfter(cause) })
  return new ProviderApiError({ operation: `${ctx.kind} ${ctx.ref}`, status, body: cause.message })
}

/** Maps a generated-client failure (`HttpClientError | SchemaError`) onto the `MksError` union. */
export const toMksError = (
  { cause, ctx }: { readonly cause: HttpClientError.HttpClientError | SchemaError; readonly ctx: ErrorContext }
): MksError => {
  if (!HttpClientError.isHttpClientError(cause)) {
    return new ResponseDecodeError({ endpoint: `${ctx.kind}/${ctx.ref}`, issue: cause.issue })
  }
  const status = cause.response?.status
  // No response at all: network/TLS/encode failure — keep the raw cause.
  return status === undefined ? new HttpTransportError({ cause }) : _byStatus({ cause, ctx, status })
}

export const mapMksError = <A, R>(
  { self, ctx }: { readonly self: Effect.Effect<A, HttpClientError.HttpClientError | SchemaError, R>; readonly ctx: ErrorContext }
): Effect.Effect<A, MksError, R> => Effect.mapError(self, (cause) => toMksError({ cause, ctx }))
