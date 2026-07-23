import type { SchemaError } from "effect/Schema"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import { AuthenticationFailed, ResourceConflict, ResourceNotFound } from "@kumulo/core"
import type { DnsError } from "@kumulo/core"

interface ErrorContext {
  readonly zone: string
  readonly name: string
}

const _ref = (ctx: ErrorContext): string => `${ctx.zone}/${ctx.name}`

// Status → tagged-error constructor, keyed by code (no switch, per project
// lint rule). Anything not listed falls through to `_fallback`.
const _byStatus: Record<number, (ctx: ErrorContext) => DnsError> = {
  401: (ctx) => new AuthenticationFailed({ hint: `${_ref(ctx)}: OVH rejected the request credentials` }),
  403: (ctx) => new AuthenticationFailed({ hint: `${_ref(ctx)}: OVH rejected the request credentials` }),
  404: (ctx) => new ResourceNotFound({ kind: "dns-record", ref: _ref(ctx) }),
  409: (ctx) => new ResourceConflict({ kind: "dns-record", ref: _ref(ctx) })
}

// ponytail: no status code in `DnsError`'s union maps cleanly onto
// transport/decode failures — fall back to `ResourceConflict` describing the
// raw failure. Revisit if a caller needs to distinguish those from a real 409.
const _fallback = (ctx: ErrorContext): DnsError => new ResourceConflict({ kind: "dns-record", ref: _ref(ctx) })

const _statusOf = (cause: HttpClientError.HttpClientError | SchemaError): number | undefined =>
  HttpClientError.isHttpClientError(cause) ? cause.response?.status : undefined

/** Maps a generated-client failure (`HttpClientError | SchemaError`) onto the `DnsError` union. */
export const toDnsError = (
  { cause, zone, name }: { readonly cause: HttpClientError.HttpClientError | SchemaError; readonly zone: string; readonly name: string }
): DnsError => {
  const status = _statusOf(cause)
  const mapped = status === undefined ? undefined : _byStatus[status]
  return mapped ? mapped({ zone, name }) : _fallback({ zone, name })
}
