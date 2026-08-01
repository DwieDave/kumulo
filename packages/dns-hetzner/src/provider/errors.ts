import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import { AuthenticationFailed, ResourceConflict, ResourceNotFound } from "@kumulo/core"
import type { DnsError } from "@kumulo/core"

interface ErrorContext {
  readonly zone: string
  readonly name: string
}

const _ref = (ctx: ErrorContext): string => `${ctx.zone}/${ctx.name}`

const _byStatus: Record<number, (ctx: ErrorContext) => DnsError> = {
  401: (ctx) => new AuthenticationFailed({ hint: `${_ref(ctx)}: Hetzner rejected the request credentials` }),
  403: (ctx) => new AuthenticationFailed({ hint: `${_ref(ctx)}: Hetzner rejected the request credentials` }),
  404: (ctx) => new ResourceNotFound({ kind: "dns-record", ref: _ref(ctx) }),
  409: (ctx) => new ResourceConflict({ kind: "dns-record", ref: _ref(ctx) })
}

// no DnsError variant maps transport/decode/retry-exhausted failures, fall back to ResourceConflict
const _fallback = (ctx: ErrorContext): DnsError => new ResourceConflict({ kind: "dns-record", ref: _ref(ctx) })

const _statusOf = (cause: HttpClientError.HttpClientError | SchemaError): number | undefined =>
  HttpClientError.isHttpClientError(cause) ? cause.response?.status : undefined

export const toDnsError = (
  { cause, zone, name }: { readonly cause: HttpClientError.HttpClientError | SchemaError; readonly zone: string; readonly name: string }
): DnsError => {
  const status = _statusOf(cause)
  const mapped = status === undefined ? undefined : _byStatus[status]
  return mapped ? mapped({ zone, name }) : _fallback({ zone, name })
}
