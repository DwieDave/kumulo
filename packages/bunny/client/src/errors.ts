import { Option, Schema } from "effect"
import type { SchemaError } from "effect/Schema"
import type * as HttpClientError from "effect/http/HttpClientError"
import {
  AuthenticationFailed,
  CapabilityMissing,
  classifyHttpError,
  HttpTransportError,
  mapHttpError,
  ProviderApiError,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "@kumulo/core"
import type { HttpErrorContext, KumuloError } from "@kumulo/core"

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

// The shared classifier is typed as the whole KumuloError union; with no isQuota hook only these tags can come out.
const _isBunnyError = (error: KumuloError): error is BunnyError =>
  error instanceof AuthenticationFailed
  || error instanceof CapabilityMissing
  || error instanceof HttpTransportError
  || error instanceof ProviderApiError
  || error instanceof RateLimited
  || error instanceof ResourceConflict
  || error instanceof ResourceNotFound
  || error instanceof ResponseDecodeError

const _narrow = ({ error, kind, ref }: { readonly error: KumuloError; readonly kind: string; readonly ref: string }): BunnyError =>
  _isBunnyError(error)
    ? error
    : new ProviderApiError({ operation: `${kind} ${ref}`, status: 0, body: `unexpected ${error._tag}` })

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

const _planPrefix = "invalid_plan_type"

const _isDuplicateKey = (key: string | undefined): boolean =>
  key !== undefined && /duplicate|already_exists|\.exists|_exists|taken|in_use/i.test(key)

const _isPlanKey = (key: string | undefined): boolean => key !== undefined && key.startsWith(_planPrefix)

const _describe = (body: BunnyErrorBody | undefined, fallback: string): string => {
  const parts = [body?.errorKey, body?.field, body?.message].flatMap((part) => (part === undefined || part === "" ? [] : [part]))

  return parts.length === 0 ? fallback : parts.join(": ")
}

const _overrideFor = (body: BunnyErrorBody | undefined) =>
(
  { kind, ref, status }: HttpErrorContext
): KumuloError | undefined => {
  if (_isPlanKey(body?.errorKey)) {
    return new CapabilityMissing({
      capability: body?.errorKey ?? _planPrefix,
      region: "bunny.net",
      workaround: _describe(body, `HTTP ${status}`)
    })
  }

  if (_isDuplicateKey(body?.errorKey) && status !== 401 && status !== 403 && status !== 404) {
    return new ResourceConflict({ kind, ref })
  }

  return undefined
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
): BunnyError =>
  _narrow({
    kind,
    ref,
    error: classifyHttpError({
      status,
      body: _describe(body, fallback ?? `HTTP ${status}`),
      kind,
      ref,
      retryAfter,
      override: _overrideFor(body)
    })
  })

export const toBunnyError = (
  { cause, kind, ref }: {
    readonly cause: HttpClientError.HttpClientError | SchemaError
    readonly kind: string
    readonly ref: string
  }
): BunnyError =>
  _narrow({
    kind,
    ref,
    error: mapHttpError({
      cause,
      kind,
      ref,
      override: (context) => _overrideFor(parseBunnyErrorBody(context.body))(context)
    })
  })

// A plan rejection has no HTTP status of its own; every port maps it the same way.
export const CAPABILITY_MISSING_STATUS = 400

export const bunnyCapabilityAsApiError = (error: BunnyError): Exclude<BunnyError, CapabilityMissing> =>
  error instanceof CapabilityMissing
    ? new ProviderApiError({
      operation: error.capability,
      status: CAPABILITY_MISSING_STATUS,
      body: error.workaround ?? error.capability
    })
    : error
