import { Effect, Predicate } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/http/HttpClientError"
import type * as HttpClientResponse from "effect/http/HttpClientResponse"
import {
  classifyHttpError,
  HttpTransportError,
  ProviderApiError,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "@kumulo/core"
import type { AuthenticationFailed, KumuloError, QuotaExceeded, RateLimited } from "@kumulo/core"

export type HcloudError =
  | AuthenticationFailed
  | QuotaExceeded
  | RateLimited
  | ProviderApiError
  | ResourceNotFound
  | ResourceConflict
  | ResponseDecodeError
  | HttpTransportError

export type HcloudCause = HttpClientError.HttpClientError | SchemaError

export interface ErrorContext {
  readonly kind: string
  readonly ref: string
}

// QuotaExceeded only fires on a machine-readable quota code; plain 403 is a credential problem, 422 is bad input
const _QUOTA_CODES = ["resource_limit_exceeded", "quota_exceeded"]

const _op = (ctx: ErrorContext): string => `${ctx.kind} ${ctx.ref}`

const _narrow = (error: KumuloError): HcloudError => {
  if (
    Predicate.isTagged(error, "AuthenticationFailed") || Predicate.isTagged(error, "QuotaExceeded")
    || Predicate.isTagged(error, "RateLimited") || Predicate.isTagged(error, "ProviderApiError")
    || Predicate.isTagged(error, "ResourceNotFound") || Predicate.isTagged(error, "ResourceConflict")
    || Predicate.isTagged(error, "ResponseDecodeError") || Predicate.isTagged(error, "HttpTransportError")
  ) return error

  return new ProviderApiError({ operation: "hcloud", status: 0, body: error._tag })
}

const _classify = (
  { body, ctx, retryAfter, status }: {
    readonly status: number
    readonly body: string
    readonly retryAfter: string | undefined
    readonly ctx: ErrorContext
  }
): HcloudError =>
  _narrow(classifyHttpError({
    status,
    body,
    kind: ctx.kind,
    ref: ctx.ref,
    retryAfter,
    isQuota: (c) => _QUOTA_CODES.some((code) => c.body.includes(code)),
    override: (c) => c.status === 423 ? new ResourceConflict({ kind: c.kind, ref: c.ref }) : undefined
  }))

const _retryAfter = (response: HttpClientResponse.HttpClientResponse): string | undefined =>
  response.headers["retry-after"] ?? response.headers["ratelimit-reset"]

const _bodyText = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<string> =>
  Effect.orElseSucceed(response.text, () => "")

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
    (body) => _classify({ ctx, status: response.status, body, retryAfter: _retryAfter(response) })
  )
}

export const mapHcloudError = <A, R>(
  { self, ctx }: { readonly self: Effect.Effect<A, HcloudCause, R>; readonly ctx: ErrorContext }
): Effect.Effect<A, HcloudError, R> =>
  Effect.catch(self, (cause) => Effect.flatMap(toHcloudError({ cause, ctx }), Effect.fail))

export const required = <A>(
  { kind, ref, value }: { readonly value: A | undefined; readonly kind: string; readonly ref: string }
): Effect.Effect<A, ResourceNotFound> =>
  value === undefined ? Effect.fail(new ResourceNotFound({ kind, ref })) : Effect.succeed(value)
