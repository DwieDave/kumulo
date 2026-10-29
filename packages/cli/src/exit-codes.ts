import { Predicate } from "effect"
import type { KumuloErrorTag } from "@kumulo/core"
import type { CliDomainError } from "./errors.ts"

export type CliExitError = CliDomainError

// Unlisted tags (defects escaping the boundary) fall back to 1 in exitCodeFor.
const _codeByTag: Record<KumuloErrorTag, number> = {
  ConfigInvalid: 2,
  AuthenticationFailed: 3,
  QuotaExceeded: 4,
  CapabilityMissing: 5,
  ResourceNotFound: 6,
  ResourceConflict: 7,
  ProvisioningTimeout: 8,
  PlanRejected: 9,
  BootstrapFailed: 10,
  AddonInstallFailed: 11,
  HttpTransportError: 12,
  ResponseDecodeError: 13,
  BucketNotEmpty: 14,
  SinkUnavailable: 15,
  RateLimited: 16,
  ProviderApiError: 17
}

const _distroNotWiredCode = 20
const _platformErrorCode = 21
const _outputsInvalidCode = 22
const _unmanagedBucketsCode = 14
const _defaultCode = 1

export const exitCodeFor = (error: CliExitError): number => {
  if (Predicate.isTagged(error, "DistroNotWired")) return _distroNotWiredCode

  if (Predicate.isTagged(error, "PlatformError")) return _platformErrorCode

  if (Predicate.isTagged(error, "OutputsInvalid")) return _outputsInvalidCode

  if (Predicate.isTagged(error, "UnmanagedBucketsPresent")) return _unmanagedBucketsCode

  return _codeByTag[error._tag] ?? _defaultCode
}
