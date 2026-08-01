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

const _op = (ctx: ErrorContext): string => `${ctx.kind} ${ctx.ref}`

interface Classified extends ErrorContext {
  readonly status: number
  readonly body: string
  readonly retryAfter: string | undefined
}

// QuotaExceeded only fires on a machine-readable quota code; plain 403 is a credential problem, 422 is bad input
const _QUOTA_CODES = ["resource_limit_exceeded", "quota_exceeded"]
const _isQuota = (body: string): boolean => _QUOTA_CODES.some((code) => body.includes(code))

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
    (body) => _classify({ ...ctx, status: response.status, body, retryAfter: _retryAfter(response) })
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

export const ignoreMissing = <A, R>(self: Effect.Effect<A, HcloudError, R>): Effect.Effect<void, HcloudError, R> =>
  Effect.asVoid(Effect.catchTag(self, "ResourceNotFound", () => Effect.void))
