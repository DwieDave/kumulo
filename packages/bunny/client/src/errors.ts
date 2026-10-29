import { Effect, Option, Schema } from "effect"
import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/http/HttpClientError"
import type * as HttpClientResponse from "effect/http/HttpClientResponse"
import {
  AuthenticationFailed,
  CapabilityMissing,
  HttpTransportError,
  ProviderApiError,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "@kumulo/core"

export const BunnyCoreErrorBody = Schema.Struct({
  ErrorKey: Schema.optional(Schema.NullOr(Schema.String)),
  Field: Schema.optional(Schema.NullOr(Schema.String)),
  Message: Schema.optional(Schema.NullOr(Schema.String))
})

export const BunnyShieldErrorBody = Schema.Struct({
  success: Schema.optional(Schema.Boolean),
  message: Schema.optional(Schema.NullOr(Schema.String)),
  errorKey: Schema.optional(Schema.NullOr(Schema.String)),
  statusCode: Schema.optional(Schema.Number)
})

export interface BunnyErrorBody {
  readonly errorKey: string | undefined
  readonly message: string | undefined
  readonly field: string | undefined
}

export type BunnyError =
  | AuthenticationFailed
  | CapabilityMissing
  | HttpTransportError
  | ProviderApiError
  | RateLimited
  | ResourceConflict
  | ResourceNotFound
  | ResponseDecodeError

const _decodeCore = Schema.decodeUnknownOption(Schema.fromJsonString(BunnyCoreErrorBody))

const _decodeShield = Schema.decodeUnknownOption(Schema.fromJsonString(BunnyShieldErrorBody))

const _nullable = (value: string | null | undefined): string | undefined => value ?? undefined

const _fromCore = (text: string): Option.Option<BunnyErrorBody> =>
  Option.flatMap(_decodeCore(text), (decoded) =>
    decoded.ErrorKey === undefined && decoded.Message === undefined && decoded.Field === undefined
      ? Option.none()
      : Option.some({ errorKey: _nullable(decoded.ErrorKey), message: _nullable(decoded.Message), field: _nullable(decoded.Field) }))

const _fromShield = (text: string): Option.Option<BunnyErrorBody> =>
  Option.flatMap(_decodeShield(text), (decoded) =>
    decoded.errorKey === undefined && decoded.message === undefined
      ? Option.none()
      : Option.some({ errorKey: _nullable(decoded.errorKey), message: _nullable(decoded.message), field: undefined }))

export const parseBunnyErrorBody = (text: string): BunnyErrorBody | undefined =>
  Option.getOrUndefined(Option.orElse(_fromCore(text), () => _fromShield(text)))

export const readBunnyErrorBody = (
  response: HttpClientResponse.HttpClientResponse
): Effect.Effect<BunnyErrorBody | undefined> =>
  response.text.pipe(
    Effect.map(parseBunnyErrorBody),
    Effect.orElseSucceed(() => undefined)
  )

const _planPrefix = "invalid_plan_type"

const _isDuplicateKey = (key: string | undefined): boolean =>
  key !== undefined && /duplicate|already_exists|\.exists|_exists|taken|in_use/i.test(key)

const _isPlanKey = (key: string | undefined): boolean => key !== undefined && key.startsWith(_planPrefix)

const _describe = (body: BunnyErrorBody | undefined, fallback: string): string => {
  const parts = [body?.errorKey, body?.field, body?.message].flatMap((part) => (part === undefined || part === "" ? [] : [part]))

  return parts.length === 0 ? fallback : parts.join(": ")
}

export const mapBunnyStatus = (
  { body, fallback, kind, ref, retryAfter, status }: {
    readonly status: number
    readonly body: BunnyErrorBody | undefined
    readonly kind: string
    readonly ref: string
    readonly retryAfter?: string | undefined
    readonly fallback?: string
  }
): BunnyError => {
  const detail = _describe(body, fallback ?? `HTTP ${status}`)

  if (_isPlanKey(body?.errorKey)) {
    return new CapabilityMissing({ capability: body?.errorKey ?? _planPrefix, region: "bunny.net", workaround: detail })
  }

  if (status === 401 || status === 403) return new AuthenticationFailed({ hint: `${kind} ${ref}: ${detail}` })

  if (status === 404) return new ResourceNotFound({ kind, ref })

  if (status === 409 || _isDuplicateKey(body?.errorKey)) return new ResourceConflict({ kind, ref })

  if (status === 429) return new RateLimited({ kind, ref, retryAfter })

  return new ProviderApiError({ operation: `${kind} ${ref}`, status, body: detail })
}

export const mapBunnyResponse = (
  { kind, ref, response }: {
    readonly response: HttpClientResponse.HttpClientResponse
    readonly kind: string
    readonly ref: string
  }
): Effect.Effect<BunnyError> =>
  Effect.map(readBunnyErrorBody(response), (body) =>
    mapBunnyStatus({ status: response.status, body, kind, ref, retryAfter: response.headers["retry-after"] }))

export const toBunnyError = (
  { body, cause, kind, ref }: {
    readonly cause: HttpClientError.HttpClientError | SchemaError
    readonly kind: string
    readonly ref: string
    readonly body?: BunnyErrorBody | undefined
  }
): BunnyError => {
  if (!HttpClientError.isHttpClientError(cause)) {
    return new ResponseDecodeError({ endpoint: `${kind}/${ref}`, issue: cause.issue })
  }

  const response = cause.response

  if (response === undefined) return new HttpTransportError({ cause })

  return mapBunnyStatus({
    status: response.status,
    body,
    kind,
    ref,
    retryAfter: response.headers["retry-after"],
    fallback: cause.message
  })
}
