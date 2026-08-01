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
import type { CloudError } from "@kumulo/core"
import { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/unstable/http/HttpClientError"

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

const _detail = ({ body, retryAfter, status }: StatusContext): string =>
  `HTTP ${status}${retryAfter === undefined ? "" : ` (retry after ${retryAfter})`}${body === "" ? "" : `: ${body}`}`

export const statusError = (context: StatusContext): OpenStackError => {
  const { body, kind, ref, retryAfter, status } = context
  if (status === 404) return new ResourceNotFound({ kind, ref })
  if (status === 409) return new ResourceConflict({ kind, ref })
  if (status === 403 && _quotaBody.test(body)) return new QuotaExceeded({ resource: kind })
  if (status === 401 || status === 403) return new AuthenticationFailed({ hint: `${kind} ${ref}: ${_detail(context)}` })
  if (status === 413 || status === 429) return new RateLimited({ kind, ref, retryAfter })
  return new ProviderApiError({ operation: `${kind} ${ref}`, status, body })
}

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
