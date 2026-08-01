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
import type { ObjectStorageError } from "@kumulo/core"

interface ErrorContext {
  readonly kind: string
  readonly ref: string
}

const _quotaMessage = /quota|over ?limit/i

const _retryAfter = (cause: HttpClientError.HttpClientError): string | undefined => cause.response?.headers["retry-after"]

// 401/403 auth, 404 not-found, 409 conflict, 413/429 rate-limited, else ProviderApiError — nothing reclassified.
const _byStatus = (
  { cause, ctx, status }: { readonly cause: HttpClientError.HttpClientError; readonly ctx: ErrorContext; readonly status: number }
): ObjectStorageError => {
  if (status === 404) return new ResourceNotFound(ctx)
  if (status === 409) return new ResourceConflict(ctx)
  if (status === 403 && _quotaMessage.test(cause.message)) return new QuotaExceeded({ resource: ctx.kind })
  if (status === 401 || status === 403) return new AuthenticationFailed({ hint: `${ctx.kind} ${ctx.ref}: ${cause.message}` })
  if (status === 413 || status === 429) return new RateLimited({ ...ctx, retryAfter: _retryAfter(cause) })
  return new ProviderApiError({ operation: `${ctx.kind} ${ctx.ref}`, status, body: cause.message })
}

export const toStorageError = (
  { cause, ctx }: { readonly cause: HttpClientError.HttpClientError | SchemaError; readonly ctx: ErrorContext }
): ObjectStorageError => {
  if (!HttpClientError.isHttpClientError(cause)) return new ResponseDecodeError({ endpoint: `${ctx.kind}/${ctx.ref}`, issue: cause.issue })
  const status = cause.response?.status
  return status === undefined ? new HttpTransportError({ cause }) : _byStatus({ cause, ctx, status })
}

export const mapStorageError = <A, R>(
  { self, ctx }: { readonly self: Effect.Effect<A, HttpClientError.HttpClientError | SchemaError, R>; readonly ctx: ErrorContext }
): Effect.Effect<A, ObjectStorageError, R> => Effect.mapError(self, (cause) => toStorageError({ cause, ctx }))
