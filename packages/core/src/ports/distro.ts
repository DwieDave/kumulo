import type {
  AuthenticationFailed,
  CapabilityMissing,
  HttpTransportError,
  ProviderApiError,
  ProvisioningTimeout,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "../errors/tagged.ts"

export type ManagedDistroError =
  | AuthenticationFailed
  | CapabilityMissing
  | ResourceNotFound
  | ResourceConflict
  | ProvisioningTimeout
  | QuotaExceeded
  | RateLimited
  | ProviderApiError
  | HttpTransportError
  | ResponseDecodeError
