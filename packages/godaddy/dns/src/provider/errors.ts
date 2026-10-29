import { Effect, Option, Schema } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/http/HttpClientError"
import {
  AuthenticationFailed,
  HttpTransportError,
  ProviderApiError,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "@kumulo/core"
import type { DnsError } from "@kumulo/core"

export const GodaddyError = Schema.Struct({
  code: Schema.String,
  message: Schema.optional(Schema.String),
  fields: Schema.optional(Schema.Array(Schema.Struct({
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    pathRelated: Schema.optional(Schema.String)
  })))
})

export const GodaddyErrorLimit = Schema.Struct({
  code: Schema.String,
  message: Schema.optional(Schema.String),
  retryAfterSec: Schema.Number,
  fields: Schema.optional(Schema.Array(Schema.Struct({
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String)
  })))
})

interface ErrorContext {
  readonly zone: string
  readonly name: string
}

const _kind = "dns-record"

const _ref = (ctx: ErrorContext): string => `${ctx.zone}/${ctx.name}`

const _describe = (body: typeof GodaddyError.Type | undefined): string =>
  body === undefined ? "no error body" : `${body.code}${body.message === undefined ? "" : `: ${body.message}`}`

const _decodeError = Schema.decodeUnknownOption(GodaddyError)

const _decodeLimit = Schema.decodeUnknownOption(GodaddyErrorLimit)

const _byStatus = (
  { body, ctx, limit, rawBody, retryAfterHeader, status }: {
    readonly status: number
    readonly ctx: ErrorContext
    readonly body: typeof GodaddyError.Type | undefined
    readonly limit: typeof GodaddyErrorLimit.Type | undefined
    readonly rawBody: string
    readonly retryAfterHeader: string | undefined
  }
): DnsError => {
  const ref = _ref(ctx)
  const detail = _describe(body)

  if (status === 401) {
    return new AuthenticationFailed({
      hint: `${ref}: GoDaddy rejected the token (${detail}); the API token is missing, expired or revoked`
    })
  }

  if (status === 403) {
    return new AuthenticationFailed({
      hint: `${ref}: GoDaddy forbade the request (${detail}); either the token lacks the domains.dns:update scope, or the account is not eligible for the DNS API (it needs at least one domain or a qualifying plan)`
    })
  }

  if (status === 404) return new ResourceNotFound({ kind: _kind, ref: `${ref} (zone not in this GoDaddy account)` })

  if (status === 409) return new ResourceConflict({ kind: _kind, ref })

  if (status === 429) {
    const seconds = limit?.retryAfterSec

    return new RateLimited({
      kind: _kind,
      ref,
      retryAfter: retryAfterHeader ?? (seconds === undefined ? undefined : String(seconds))
    })
  }

  if (status === 422) {
    return new ProviderApiError({ operation: `${_kind} ${ref} [${body?.code ?? "UNKNOWN"}]`, status, body: rawBody })
  }

  return new ProviderApiError({ operation: `${_kind} ${ref}`, status, body: rawBody })
}

export const toDnsError = (
  { cause, name, zone }: {
    readonly cause: HttpClientError.HttpClientError | SchemaError
    readonly zone: string
    readonly name: string
  }
): Effect.Effect<DnsError> => {
  const ctx = { zone, name }

  if (!HttpClientError.isHttpClientError(cause)) {
    return Effect.succeed(new ResponseDecodeError({ endpoint: `${_kind}/${_ref(ctx)}`, issue: cause.issue }))
  }

  const response = cause.response

  if (response === undefined) return Effect.succeed(new HttpTransportError({ cause }))

  return response.text.pipe(
    Effect.orElseSucceed(() => ""),
    Effect.map((rawBody) => {
      const parsed = Option.liftThrowable(JSON.parse)(rawBody)

      return _byStatus({
        status: response.status,
        ctx,
        rawBody,
        retryAfterHeader: response.headers["retry-after"],
        body: Option.getOrUndefined(Option.flatMap(parsed, _decodeError)),
        limit: Option.getOrUndefined(Option.flatMap(parsed, _decodeLimit))
      })
    })
  )
}
