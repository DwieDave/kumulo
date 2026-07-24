import type { KumuloError, KumuloErrorTag } from "./tagged.ts"

const retryableByTag: Record<KumuloErrorTag, boolean> = {
  HttpTransportError: true,
  ResponseDecodeError: false,
  AuthenticationFailed: false,
  QuotaExceeded: false,
  ResourceNotFound: false,
  ResourceConflict: true,
  CapabilityMissing: false,
  ProvisioningTimeout: true,
  ConfigInvalid: false,
  PlanRejected: false,
  BootstrapFailed: false,
  AddonInstallFailed: false,
  BucketNotEmpty: false,
  SinkUnavailable: false
}

export const isRetryable = (error: KumuloError): boolean => retryableByTag[error._tag]
