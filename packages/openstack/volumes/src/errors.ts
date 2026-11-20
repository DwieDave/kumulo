import {
  AuthenticationFailed,
  classifyHttpError,
  HttpTransportError,
  ProviderApiError,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "@kumulo/core"
import type { KumuloError, VolumeError } from "@kumulo/core"
import { Effect } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/http/HttpClientError"
import type * as HttpClientResponse from "effect/http/HttpClientResponse"

export type CinderError = VolumeError | RateLimited | ProviderApiError | ResponseDecodeError | HttpTransportError

export type CinderCause = HttpClientError.HttpClientError | SchemaError

const _kind = "volume"

const _quotaBody = /quota|over ?limit/i

// classifyHttpError only ever builds these tags; the fallback keeps the narrowing total without a cast
const _narrow = (error: KumuloError): CinderError =>
  error instanceof AuthenticationFailed ||
    error instanceof ResourceNotFound ||
    error instanceof ResourceConflict ||
    error instanceof RateLimited ||
    error instanceof QuotaExceeded ||
    error instanceof ProviderApiError
    ? error
    : new ProviderApiError({ operation: "classify", status: 0, body: error.message })

const _bodyText = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<string> =>
  Effect.orElseSucceed(response.text, () => "")

// 413 maps to RateLimited in the core table, matching Cinder's over-limit responses
export const toCinderError = (
  { cause, ref }: { readonly cause: CinderCause; readonly ref: string }
): Effect.Effect<CinderError> => {
  // A malformed body must decode-error, never silently become an empty list (ensureVolume would create a duplicate billed volume).
  if (!HttpClientError.isHttpClientError(cause)) {
    return Effect.succeed(new ResponseDecodeError({ endpoint: ref, issue: cause.issue }))
  }

  const response = cause.response

  if (response === undefined) return Effect.succeed(new HttpTransportError({ cause }))

  return Effect.map(
    _bodyText(response),
    (body): CinderError =>
      _narrow(classifyHttpError({
        status: response.status,
        body,
        kind: _kind,
        ref,
        retryAfter: response.headers["retry-after"],
        isQuota: (context) => context.status === 403 && _quotaBody.test(context.body)
      }))
  )
}

export const mapCinderError = <A, R>(
  { ref, self }: { readonly self: Effect.Effect<A, CinderCause, R>; readonly ref: string }
): Effect.Effect<A, CinderError, R> =>
  Effect.catch(self, (cause) => Effect.flatMap(toCinderError({ cause, ref }), Effect.fail))
