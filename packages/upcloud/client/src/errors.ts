// Quota: 402, or 403 with classic-body error_code ending _LIMIT_REACHED. Non-classic bodies (RFC 7807) use status only.
import { Effect, Option, Predicate, Schema } from "effect"
import {
  AuthenticationFailed,
  HttpTransportError,
  ignoreNotFound,
  mapHttpError,
  ProviderApiError,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "@kumulo/core"
import type { HttpErrorContext, KumuloError } from "@kumulo/core"
import type { UpcloudRawError } from "./client/common.ts"

export type UpcloudCause = UpcloudRawError

export type UpcloudError =
  | AuthenticationFailed
  | QuotaExceeded
  | RateLimited
  | ProviderApiError
  | ResourceNotFound
  | ResourceConflict
  | ResponseDecodeError
  | HttpTransportError

// mapHttpError is typed as the wide KumuloError; it only ever produces the members above
const _isUpcloudError = (error: KumuloError): error is UpcloudError =>
  error instanceof AuthenticationFailed ||
  error instanceof QuotaExceeded ||
  error instanceof RateLimited ||
  error instanceof ProviderApiError ||
  error instanceof ResourceNotFound ||
  error instanceof ResourceConflict ||
  error instanceof ResponseDecodeError ||
  error instanceof HttpTransportError

export interface ErrorContext {
  readonly kind: string
  readonly ref: string
}

const _ClassicBody = Schema.fromJsonString(Schema.Struct({
  error: Schema.Struct({ error_code: Schema.String })
}))

const _errorCode = (body: string): string | undefined =>
  Option.getOrUndefined(Option.map(Schema.decodeUnknownOption(_ClassicBody)(body), (b) => b.error.error_code))

export const isUpcloudQuota = ({ status, body }: HttpErrorContext): boolean =>
  status === 402 || (status === 403 && _errorCode(body)?.endsWith("_LIMIT_REACHED") === true)

export const mapUpcloudError = <A, R>(
  { self, ctx }: { readonly self: Effect.Effect<A, UpcloudCause, R>; readonly ctx: ErrorContext }
): Effect.Effect<A, UpcloudError, R> =>
  Effect.mapError(self, (cause): UpcloudError => {
    if (Predicate.isTagged(cause, "PaginationLimitExceeded") || Predicate.isTagged(cause, "PaginationStalled")) {
      return new ProviderApiError({ operation: `${ctx.kind} ${ctx.ref}`, status: 0, body: `pagination failed: ${cause._tag}` })
    }

    const mapped = mapHttpError({ cause, kind: ctx.kind, ref: ctx.ref, isQuota: isUpcloudQuota })

    return _isUpcloudError(mapped)
      ? mapped
      : new ProviderApiError({ operation: `${ctx.kind} ${ctx.ref}`, status: 0, body: mapped._tag })
  })

export const ignoreMissing = ignoreNotFound
