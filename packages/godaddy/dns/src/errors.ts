import { Effect, Option, Predicate, Schema } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/http/HttpClientError"
import { AuthenticationFailed, HttpTransportError, ProviderApiError, RateLimited, ResourceNotFound, ResponseDecodeError, classifyHttpError } from "@kumulo/core"
import type { DnsError, HttpErrorContext, KumuloError } from "@kumulo/core"

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

const _override = (ctx: HttpErrorContext): DnsError | undefined => {
  const parsed = Option.liftThrowable(JSON.parse)(ctx.body)
  const body = Option.getOrUndefined(Option.flatMap(parsed, _decodeError))
  const detail = _describe(body)

  if (ctx.status === 401) {
    return new AuthenticationFailed({
      hint: `${ctx.ref}: GoDaddy rejected the token (${detail}); the API token is missing, expired or revoked`
    })
  }

  if (ctx.status === 403) {
    return new AuthenticationFailed({
      hint: `${ctx.ref}: GoDaddy forbade the request (${detail}); either the token lacks the domains.dns:update scope, or the account is not eligible for the DNS API (it needs at least one domain or a qualifying plan)`
    })
  }

  if (ctx.status === 404) return new ResourceNotFound({ kind: _kind, ref: `${ctx.ref} (zone not in this GoDaddy account)` })

  if (ctx.status === 429) {
    const seconds = Option.getOrUndefined(Option.flatMap(parsed, _decodeLimit))?.retryAfterSec

    return new RateLimited({
      kind: _kind,
      ref: ctx.ref,
      retryAfter: ctx.retryAfter ?? (seconds === undefined ? undefined : String(seconds))
    })
  }

  if (ctx.status === 422) {
    return new ProviderApiError({
      operation: `${_kind} ${ctx.ref} [${body?.code ?? "UNKNOWN"}]`,
      status: ctx.status,
      body: ctx.body
    })
  }

  return undefined
}

const _asDnsError = (error: KumuloError): DnsError => {
  if (
    Predicate.isTagged(error, "ResourceNotFound") || Predicate.isTagged(error, "ResourceConflict")
    || Predicate.isTagged(error, "AuthenticationFailed") || Predicate.isTagged(error, "RateLimited")
    || Predicate.isTagged(error, "ProviderApiError") || Predicate.isTagged(error, "ResponseDecodeError")
    || Predicate.isTagged(error, "HttpTransportError")
  ) return error

  return new ProviderApiError({ operation: _kind, status: 0, body: error._tag })
}

export const toDnsError = (
  { cause, name, zone }: {
    readonly cause: HttpClientError.HttpClientError | SchemaError
    readonly zone: string
    readonly name: string
  }
): Effect.Effect<DnsError> => {
  const ref = _ref({ zone, name })

  if (!HttpClientError.isHttpClientError(cause)) {
    return Effect.succeed(new ResponseDecodeError({ endpoint: `${_kind}/${ref}`, issue: cause.issue }))
  }

  const response = cause.response

  if (response === undefined) return Effect.succeed(new HttpTransportError({ cause }))

  return response.text.pipe(
    Effect.orElseSucceed(() => ""),
    Effect.map((body) =>
      _asDnsError(classifyHttpError({
        status: response.status,
        body,
        kind: _kind,
        ref,
        retryAfter: response.headers["retry-after"],
        override: _override
      }))
    )
  )
}
