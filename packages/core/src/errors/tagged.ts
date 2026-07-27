import { Data } from "effect"
import type { SchemaIssue } from "effect"

export class HttpTransportError extends Data.TaggedError("HttpTransportError")<{
  readonly cause: unknown
}> {}

export class ResponseDecodeError extends Data.TaggedError("ResponseDecodeError")<{
  readonly endpoint: string
  readonly issue: SchemaIssue.Issue
}> {}

export class AuthenticationFailed extends Data.TaggedError("AuthenticationFailed")<{
  readonly hint: string
}> {}

// Only raised when the provider genuinely says "quota". `limit`/`requested`
// are optional because most providers do not report them — an absent number
// must stay absent rather than be faked as `0`.
export class QuotaExceeded extends Data.TaggedError("QuotaExceeded")<{
  readonly resource: string
  readonly limit?: number | undefined
  readonly requested?: number | undefined
}> {}

// HTTP 429 (or a provider-specific rate-limit signal). `retryAfter` is the
// `Retry-After` header verbatim when the server sent one.
export class RateLimited extends Data.TaggedError("RateLimited")<{
  readonly kind: string
  readonly ref: string
  readonly retryAfter?: string | undefined
}> {}

// Any provider-side failure that is not one of the classified cases above —
// notably 5xx. Carries the observed status and (truncated) body so an on-call
// operator sees the outage instead of a fabricated credential problem.
export class ProviderApiError extends Data.TaggedError("ProviderApiError")<{
  readonly operation: string
  readonly status: number
  readonly body: string
}> {}

export class ResourceNotFound extends Data.TaggedError("ResourceNotFound")<{
  readonly kind: string
  readonly ref: string
}> {}

export class ResourceConflict extends Data.TaggedError("ResourceConflict")<{
  readonly kind: string
  readonly ref: string
}> {}

export class CapabilityMissing extends Data.TaggedError("CapabilityMissing")<{
  readonly capability: string
  readonly region: string
  readonly workaround?: string
}> {}

export class ProvisioningTimeout extends Data.TaggedError("ProvisioningTimeout")<{
  readonly kind: string
  readonly ref: string
  readonly lastStatus: string
}> {}

export interface PathedIssue {
  readonly path: ReadonlyArray<PropertyKey>
  readonly message: string
}

export class ConfigInvalid extends Data.TaggedError("ConfigInvalid")<{
  readonly issues: ReadonlyArray<PathedIssue>
}> {}

export class PlanRejected extends Data.TaggedError("PlanRejected")<{
  readonly reason: string
}> {}

export class BootstrapFailed extends Data.TaggedError("BootstrapFailed")<{
  readonly node: string
  readonly phase: string
  readonly log: string
}> {}

export class AddonInstallFailed extends Data.TaggedError("AddonInstallFailed")<{
  readonly addon: string
  readonly cause: string
}> {}

// Deleting a bucket that still has objects refuses rather than force-deleting
// (scope.md decision 2026-07-24 — no force_destroy in v1).
export class BucketNotEmpty extends Data.TaggedError("BucketNotEmpty")<{
  readonly bucket: string
  readonly objectCount: number
}> {}

export class SinkUnavailable extends Data.TaggedError("SinkUnavailable")<{
  readonly hint: string
}> {}

export type KumuloError =
  | HttpTransportError
  | ResponseDecodeError
  | AuthenticationFailed
  | QuotaExceeded
  | RateLimited
  | ProviderApiError
  | ResourceNotFound
  | ResourceConflict
  | CapabilityMissing
  | ProvisioningTimeout
  | ConfigInvalid
  | PlanRejected
  | BootstrapFailed
  | AddonInstallFailed
  | BucketNotEmpty
  | SinkUnavailable

export type KumuloErrorTag = KumuloError["_tag"]

export type CredentialsSinkError = SinkUnavailable
