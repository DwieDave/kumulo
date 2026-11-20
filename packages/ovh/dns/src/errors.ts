import { Effect } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/http/HttpClientError"
import { HttpTransportError, ProviderApiError, ResponseDecodeError, classifyHttpError } from "@kumulo/core"
import type { DnsError, KumuloError } from "@kumulo/core"

interface ErrorContext {
  readonly zone: string
  readonly name: string
}

const _kind = "dns-record"

const _ref = (ctx: ErrorContext): string => `${ctx.zone}/${ctx.name}`

const _dnsTags: ReadonlySet<string> = new Set([
  "ResourceNotFound",
  "ResourceConflict",
  "AuthenticationFailed",
  "RateLimited",
  "ProviderApiError",
  "ResponseDecodeError",
  "HttpTransportError"
])

const _isDnsError = (error: KumuloError): error is DnsError => _dnsTags.has(error._tag)

const _asDnsError = (error: KumuloError): DnsError =>
  _isDnsError(error)
    ? error
    : new ProviderApiError({ operation: `${_kind} ${error._tag}`, status: 0, body: "unexpected error class" })

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
    Effect.orElseSucceed(() => cause.message),
    Effect.map((body) =>
      _asDnsError(classifyHttpError({
        status: response.status,
        body,
        kind: _kind,
        ref,
        retryAfter: response.headers["retry-after"]
      }))
    )
  )
}

export const mapDnsError = <A, R>(
  { self, zone, name }: {
    readonly self: Effect.Effect<A, HttpClientError.HttpClientError | SchemaError, R>
    readonly zone: string
    readonly name: string
  }
): Effect.Effect<A, DnsError, R> =>
  self.pipe(Effect.catch((cause) => Effect.flatMap(toDnsError({ cause, zone, name }), (error) => Effect.fail(error))))

