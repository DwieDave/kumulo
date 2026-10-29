// UpCloud's 4xx error body shape is unconfirmed (needs a live probe); quota detection is status-only (402), not body-sniffed.
import { Effect, Match, Option, Schema } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/http/HttpClientError"
import type * as HttpClientResponse from "effect/http/HttpClientResponse"
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

export type UpcloudError =
  | AuthenticationFailed
  | QuotaExceeded
  | RateLimited
  | ProviderApiError
  | ResourceNotFound
  | ResourceConflict
  | ResponseDecodeError
  | HttpTransportError

export type UpcloudCause = HttpClientError.HttpClientError | SchemaError

export interface ErrorContext {
  readonly kind: string
  readonly ref: string
}

const _op = (ctx: ErrorContext): string => `${ctx.kind} ${ctx.ref}`

export interface Classified extends ErrorContext {
  readonly status: number
  readonly body: string
  readonly retryAfter: string | undefined
}

const _ClassicBody = Schema.fromJsonString(Schema.Struct({
  error: Schema.Struct({ error_code: Schema.String })
}))

export const upcloudErrorCode = (body: string): string | undefined =>
  Option.getOrUndefined(Option.map(Schema.decodeUnknownOption(_ClassicBody)(body), (b) => b.error.error_code))

export const statusError = (c: Classified): UpcloudError =>
  Match.value(c.status).pipe(
    Match.when(401, () => new AuthenticationFailed({ hint: `${_op(c)}: UpCloud rejected the API token` })),
    Match.when(402, () => new QuotaExceeded({ resource: c.kind })),
    Match.when(403, () =>
      upcloudErrorCode(c.body)?.endsWith("_LIMIT_REACHED") === true
        ? new QuotaExceeded({ resource: c.kind })
        : new AuthenticationFailed({ hint: `${_op(c)}: UpCloud API token lacks permission` })),
    Match.when(404, () => new ResourceNotFound({ kind: c.kind, ref: c.ref })),
    Match.when(409, () => new ResourceConflict({ kind: c.kind, ref: c.ref })),
    Match.when(429, () => new RateLimited({ kind: c.kind, ref: c.ref, retryAfter: c.retryAfter })),
    Match.orElse(() => new ProviderApiError({ operation: _op(c), status: c.status, body: c.body.slice(0, 512) }))
  )

const _retryAfter = (response: HttpClientResponse.HttpClientResponse): string | undefined =>
  response.headers["retry-after"] ?? response.headers["ratelimit-reset"]

const _bodyText = (response: HttpClientResponse.HttpClientResponse): Effect.Effect<string> =>
  Effect.orElseSucceed(response.text, () => "")

export const toUpcloudError = (
  { cause, ctx }: { readonly cause: UpcloudCause; readonly ctx: ErrorContext }
): Effect.Effect<UpcloudError> => {
  if (!HttpClientError.isHttpClientError(cause)) {
    return Effect.succeed(new ResponseDecodeError({ endpoint: _op(ctx), issue: cause.issue }))
  }

  const response = cause.response

  if (response === undefined) return Effect.succeed(new HttpTransportError({ cause }))

  return Effect.map(
    _bodyText(response),
    (body) => statusError({ ...ctx, status: response.status, body, retryAfter: _retryAfter(response) })
  )
}

export const mapUpcloudError = <A, R>(
  { self, ctx }: { readonly self: Effect.Effect<A, UpcloudCause, R>; readonly ctx: ErrorContext }
): Effect.Effect<A, UpcloudError, R> =>
  Effect.catch(self, (cause) => Effect.flatMap(toUpcloudError({ cause, ctx }), Effect.fail))

export const ignoreMissing = <A, R>(self: Effect.Effect<A, UpcloudError, R>): Effect.Effect<void, UpcloudError, R> =>
  Effect.asVoid(Effect.catchTag(self, "ResourceNotFound", () => Effect.void))
