import { Predicate } from "effect"
import type { SchemaError } from "effect/Schema"
import type * as HttpClientError from "effect/http/HttpClientError"
import { mapHttpError, ProviderApiError } from "@kumulo/core"
import type { DnsError, KumuloError } from "@kumulo/core"

const _kind = "dns-record"

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
    readonly cause: HttpClientError.HttpClientError | SchemaError | ProviderApiError
    readonly zone: string
    readonly name: string
  }
): DnsError =>
  Predicate.isTagged(cause, "ProviderApiError") ? cause : _asDnsError(mapHttpError({ cause, kind: _kind, ref: `${zone}/${name}` }))
