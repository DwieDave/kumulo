export const packageName = "@kumulo/core"

export {
  AddonInstallFailed,
  AuthenticationFailed,
  BootstrapFailed,
  CapabilityMissing,
  ConfigInvalid,
  HttpTransportError,
  PlanRejected,
  ProvisioningTimeout,
  QuotaExceeded,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "./errors/tagged.ts"
export type { KumuloError, KumuloErrorTag, PathedIssue } from "./errors/tagged.ts"
export { isRetryable } from "./errors/retryable.ts"
export { renderError } from "./errors/renderer.ts"
export type { RendererRegistry } from "./errors/renderer.ts"
