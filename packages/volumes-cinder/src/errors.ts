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
import type { VolumeError } from "@kumulo/core"
import { Effect } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"

export type CinderError = VolumeError | RateLimited | ProviderApiError | ResponseDecodeError | HttpTransportError

export type CinderCause = HttpClientError.HttpClientError | SchemaError

const _kind = "volume"
const _BODY_LIMIT = 512

const _quotaBody = /quota|over ?limit/i

interface Classified {
  readonly ref: string
  readonly status: number
  readonly body: string
  readonly retryAfter: string | undefined
}

const _classify = ({ body, ref, retryAfter, status }: Classified): CinderError => {
  if (status === 404) return new ResourceNotFound({ kind: _kind, ref })
  if (status === 409) return new ResourceConflict({ kind: _kind, ref })
  if (status === 403 && _quotaBody.test(body)) return new QuotaExceeded({ resource: _kind })
  if (status === 401 || status === 403) return new AuthenticationFailed({ hint: `${_kind} ${ref}: HTTP ${status}` })
  if (status === 413 || status === 429) return new RateLimited({ kind: _kind, ref, retryAfter })
  return new ProviderApiError({ operation: `${_kind} ${ref}`, status, body: body.slice(0, _BODY_LIMIT) })
}

const _bodyText = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<string> =>
  Effect.orElseSucceed(response.text, () => "")

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
    (body) => _classify({ ref, status: response.status, body, retryAfter: response.headers["retry-after"] })
  )
}

export const mapCinderError = <A, R>(
  { ref, self }: { readonly self: Effect.Effect<A, CinderCause, R>; readonly ref: string }
): Effect.Effect<A, CinderError, R> =>
  Effect.catch(self, (cause) => Effect.flatMap(toCinderError({ cause, ref }), Effect.fail))
