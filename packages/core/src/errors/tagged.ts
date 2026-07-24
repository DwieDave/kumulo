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

export class QuotaExceeded extends Data.TaggedError("QuotaExceeded")<{
  readonly resource: string
  readonly limit: number
  readonly requested: number
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
