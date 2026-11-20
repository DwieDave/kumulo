import { Effect, Predicate } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/http/HttpClientError"
import {
  AuthenticationFailed,
  HttpTransportError,
  ProviderApiError,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "../errors/tagged.ts"
import type { KumuloError } from "../errors/tagged.ts"

export const HTTP_ERROR_BODY_LIMIT = 512

export interface HttpErrorContext {
  readonly status: number
  readonly body: string
  readonly kind: string
  readonly ref: string
  readonly retryAfter?: string | undefined
}

export interface ClassifyOptions extends HttpErrorContext {
  readonly operation?: string | undefined
  // return an error to short-circuit the default table (provider-specific bodies)
  readonly override?: ((context: HttpErrorContext) => KumuloError | undefined) | undefined
  readonly isQuota?: ((context: HttpErrorContext) => boolean) | undefined
}

export type HttpMappedError =
  | AuthenticationFailed
  | ResourceNotFound
  | ResourceConflict
  | RateLimited
  | QuotaExceeded
  | ProviderApiError
  | HttpTransportError
  | ResponseDecodeError

export const truncateBody = (body: string): string => body.slice(0, HTTP_ERROR_BODY_LIMIT)

export const classifyHttpError = (options: ClassifyOptions): KumuloError => {
  const { isQuota, kind, operation, override, ref, retryAfter, status } = options
  const body = truncateBody(options.body)
  const context: HttpErrorContext = { status, body, kind, ref, retryAfter }
  const overridden = override?.(context)

  if (overridden !== undefined) return overridden

  if (isQuota?.(context) === true) return new QuotaExceeded({ resource: kind })

  if (status === 401 || status === 403) return new AuthenticationFailed({ hint: `${kind} ${ref}: ${body || `HTTP ${status}`}` })

  if (status === 404) return new ResourceNotFound({ kind, ref })

  if (status === 409) return new ResourceConflict({ kind, ref })

  if (status === 413 || status === 429) return new RateLimited({ kind, ref, retryAfter })

  return new ProviderApiError({ operation: operation ?? `${kind} ${ref}`, status, body })
}

export interface MapHttpErrorOptions {
  readonly cause: HttpClientError.HttpClientError | SchemaError
  readonly kind: string
  readonly ref: string
  readonly operation?: string | undefined
  readonly override?: ClassifyOptions["override"]
  readonly isQuota?: ClassifyOptions["isQuota"]
}

export const mapHttpError = (options: MapHttpErrorOptions): KumuloError => {
  const { cause, kind, ref } = options

  if (!HttpClientError.isHttpClientError(cause)) {
    return new ResponseDecodeError({ endpoint: `${kind}/${ref}`, issue: cause.issue })
  }

  const reason = cause.reason

  if (!Predicate.isTagged(reason, "StatusCodeError")) return new HttpTransportError({ cause })

  return classifyHttpError({
    ...options,
    status: reason.response.status,
    body: reason.description ?? "",
    retryAfter: reason.response.headers["retry-after"]
  })
}

export const ignoreNotFound = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, E, R> =>
  Effect.catch(
    Effect.asVoid(effect),
    (error) => error instanceof ResourceNotFound ? Effect.void : Effect.fail(error)
  )
