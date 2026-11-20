import {
  AuthenticationFailed,
  classifyHttpError,
  HttpTransportError,
  ProviderApiError,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "@kumulo/core"
import type { CloudError, KumuloError } from "@kumulo/core"
import { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/http/HttpClientError"

export type OpenStackError = CloudError | RateLimited | ProviderApiError | ResponseDecodeError | HttpTransportError

export interface StatusContext {
  readonly status: number
  readonly kind: string
  readonly ref: string
  readonly body: string
  readonly retryAfter?: string | undefined
}

// OpenStack reports over-quota as a 403 whose body names the quota; there's no dedicated status code for it.
const _quotaBody = /quota|over ?limit/i

// classifyHttpError only ever builds these tags; the fallback keeps the narrowing total without a cast
const _narrow = (error: KumuloError): OpenStackError =>
  error instanceof AuthenticationFailed ||
    error instanceof ResourceNotFound ||
    error instanceof ResourceConflict ||
    error instanceof RateLimited ||
    error instanceof QuotaExceeded ||
    error instanceof ProviderApiError
    ? error
    : new ProviderApiError({ operation: "classify", status: 0, body: error.message })

export const statusError = (context: StatusContext): OpenStackError =>
  _narrow(classifyHttpError({
    ...context,
    isQuota: ({ body, status }) => status === 403 && _quotaBody.test(body)
  }))

const _description = (cause: HttpClientError.HttpClientError): string =>
  "description" in cause.reason ? cause.reason.description ?? "" : ""

export interface ErrorContext {
  readonly kind: string
  readonly ref: string
}

export const toOpenStackError = (
  context: ErrorContext
) =>
(cause: unknown): OpenStackError => {
  if (cause instanceof SchemaError) {
    return new ResponseDecodeError({ endpoint: context.kind, issue: cause.issue })
  }

  if (!HttpClientError.isHttpClientError(cause)) {
    return new ProviderApiError({ operation: `${context.kind} ${context.ref}`, status: 0, body: String(cause) })
  }

  const response = cause.response

  return response === undefined
    ? new HttpTransportError({ cause })
    : statusError({
      status: response.status,
      kind: context.kind,
      ref: context.ref,
      body: _description(cause),
      retryAfter: response.headers["retry-after"]
    })
}
