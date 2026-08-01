import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
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

interface ErrorContext {
  readonly zone: string
  readonly name: string
}

const _kind = "dns-record"

const _ref = (ctx: ErrorContext): string => `${ctx.zone}/${ctx.name}`

const _retryAfter = (cause: HttpClientError.HttpClientError): string | undefined => cause.response?.headers["retry-after"]

const _byStatus = (
  { cause, ctx, status }: {
    readonly cause: HttpClientError.HttpClientError
    readonly ctx: ErrorContext
    readonly status: number
  }
): DnsError => {
  const ref = _ref(ctx)
  if (status === 404) return new ResourceNotFound({ kind: _kind, ref })
  if (status === 409) return new ResourceConflict({ kind: _kind, ref })
  if (status === 401 || status === 403) return new AuthenticationFailed({ hint: `${ref}: ${cause.message}` })
  if (status === 413 || status === 429) return new RateLimited({ kind: _kind, ref, retryAfter: _retryAfter(cause) })
  return new ProviderApiError({ operation: `${_kind} ${ref}`, status, body: cause.message })
}

export const toDnsError = (
  { cause, name, zone }: {
    readonly cause: HttpClientError.HttpClientError | SchemaError
    readonly zone: string
    readonly name: string
  }
): DnsError => {
  const ctx = { zone, name }
  if (!HttpClientError.isHttpClientError(cause)) {
    return new ResponseDecodeError({ endpoint: `${_kind}/${_ref(ctx)}`, issue: cause.issue })
  }
  const status = cause.response?.status
  return status === undefined ? new HttpTransportError({ cause }) : _byStatus({ cause, ctx, status })
}
