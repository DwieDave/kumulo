import type { KumuloErrorTag } from "@kumulo/core"
import type { CliDomainError } from "./errors.ts"

export type CliExitError = CliDomainError

/**
 * One distinct exit code per error family, so scripts/CI can branch on
 * failure kind without parsing the message. `0` is reserved for success and
 * never appears here; unlisted tags (defects escaping the boundary) fall
 * back to `1` in `exitCodeFor`.
 */
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
const _defaultCode = 1

export const exitCodeFor = (error: CliExitError): number => {
  if (error._tag === "DistroNotWired") return _distroNotWiredCode
  if (error._tag === "PlatformError") return _platformErrorCode
  if (error._tag === "OutputsInvalid") return _outputsInvalidCode
  return _codeByTag[error._tag] ?? _defaultCode
}
