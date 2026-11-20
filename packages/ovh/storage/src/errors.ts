import { Effect } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/http/HttpClientError"
import { HttpTransportError, ProviderApiError, ResponseDecodeError, classifyHttpError } from "@kumulo/core"
import type { HttpErrorContext, KumuloError, ObjectStorageError } from "@kumulo/core"

interface ErrorContext {
  readonly kind: string
  readonly ref: string
}

const _quotaMessage = /quota|over ?limit/i

const _isQuota = (ctx: HttpErrorContext): boolean => ctx.status === 403 && _quotaMessage.test(ctx.body)

const _storageTags: ReadonlySet<string> = new Set([
  "ResourceNotFound",
  "ResourceConflict",
  "AuthenticationFailed",
  "QuotaExceeded",
  "BucketNotEmpty",
  "HttpTransportError",
  "ResponseDecodeError",
  "RateLimited",
  "ProviderApiError"
])

const _isStorageError = (error: KumuloError): error is ObjectStorageError => _storageTags.has(error._tag)

const _asStorageError = (error: KumuloError): ObjectStorageError =>
  _isStorageError(error)
    ? error
    : new ProviderApiError({ operation: error._tag, status: 0, body: "unexpected error class" })

export const toStorageError = (
  { cause, ctx }: { readonly cause: HttpClientError.HttpClientError | SchemaError; readonly ctx: ErrorContext }
): Effect.Effect<ObjectStorageError> => {
  if (!HttpClientError.isHttpClientError(cause)) {
    return Effect.succeed(new ResponseDecodeError({ endpoint: `${ctx.kind}/${ctx.ref}`, issue: cause.issue }))
  }

  const response = cause.response

  if (response === undefined) return Effect.succeed(new HttpTransportError({ cause }))

  return response.text.pipe(
    Effect.orElseSucceed(() => cause.message),
    Effect.map((body) =>
      _asStorageError(classifyHttpError({
        status: response.status,
        body,
        kind: ctx.kind,
        ref: ctx.ref,
        retryAfter: response.headers["retry-after"],
        isQuota: _isQuota
      }))
    )
  )
}

export const mapStorageError = <A, R>(
  { self, ctx }: { readonly self: Effect.Effect<A, HttpClientError.HttpClientError | SchemaError, R>; readonly ctx: ErrorContext }
): Effect.Effect<A, ObjectStorageError, R> =>
  self.pipe(Effect.catch((cause) => Effect.flatMap(toStorageError({ cause, ctx }), (error) => Effect.fail(error))))
