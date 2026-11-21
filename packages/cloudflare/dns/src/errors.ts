import { Effect, Option, Predicate, Schema } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/http/HttpClientError"
import { AuthenticationFailed, HttpTransportError, ProviderApiError, RateLimited, ResourceNotFound, ResponseDecodeError, classifyHttpError } from "@kumulo/core"
import type { DnsError, HttpErrorContext, KumuloError } from "@kumulo/core"

// The failure envelope every Cloudflare v4 endpoint returns (api-response-common-failure in the spec).
export const CloudflareFailure = Schema.Struct({
  errors: Schema.Array(Schema.Struct({ code: Schema.Number, message: Schema.String }))
})

const _kind = "dns-record"

const _decodeFailure = Schema.decodeUnknownOption(CloudflareFailure)

const _describe = (body: typeof CloudflareFailure.Type | undefined): string =>
  body === undefined || body.errors.length === 0
    ? "no error body"
    : body.errors.map((error) => `${error.code}: ${error.message}`).join("; ")

const _codes = (body: typeof CloudflareFailure.Type | undefined): string =>
  body === undefined || body.errors.length === 0 ? "UNKNOWN" : body.errors.map((error) => error.code).join(",")

const _override = (ctx: HttpErrorContext): DnsError | undefined => {
  const body = Option.getOrUndefined(Option.flatMap(Option.liftThrowable(JSON.parse)(ctx.body), _decodeFailure))
  const detail = _describe(body)

  if (ctx.status === 401) {
    return new AuthenticationFailed({
      hint: `${ctx.ref}: Cloudflare rejected the token (${detail}); CLOUDFLARE_API_TOKEN is missing, expired or revoked`
    })
  }

  if (ctx.status === 403) {
    return new AuthenticationFailed({
      hint: `${ctx.ref}: Cloudflare forbade the request (${detail}); the API token needs Zone:Read and DNS:Edit on this zone`
    })
  }

  if (ctx.status === 404) {
    return new ResourceNotFound({ kind: _kind, ref: `${ctx.ref} (zone or record not visible to this Cloudflare token)` })
  }

  if (ctx.status === 429) return new RateLimited({ kind: _kind, ref: ctx.ref, retryAfter: ctx.retryAfter })

  if (ctx.status === 400) {
    return new ProviderApiError({ operation: `${_kind} ${ctx.ref} [${_codes(body)}]`, status: ctx.status, body: ctx.body })
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
  const ref = `${zone}/${name}`

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
