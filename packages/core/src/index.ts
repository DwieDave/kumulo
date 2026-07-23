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

export { ClusterConfig, decodeConfig, encodeConfig, parseConfigYaml, stringifyConfigYaml } from "./config/index.ts"
export type { ClusterConfigEncoded, WorkerPool } from "./config/index.ts"

export { Addon } from "./ports/addon.ts"
export type { AddonError } from "./ports/addon.ts"
export { CloudProvider } from "./ports/cloud-provider.ts"
export type { CloudError } from "./ports/cloud-provider.ts"
export { Distro } from "./ports/distro.ts"
export type { DistroShape, ManagedDistroShape, MksError, SelfManagedDistroShape } from "./ports/distro.ts"
export { DnsProvider } from "./ports/dns-provider.ts"
export type { DnsError } from "./ports/dns-provider.ts"
export { ProviderProfile } from "./ports/provider-profile.ts"
export type { AuthDefaults, ProfileError } from "./ports/provider-profile.ts"
export { validateAutoscaling, validateCni } from "./ports/validation.ts"
export { VolumeProvider } from "./ports/volume-provider.ts"
export type { VolumeError } from "./ports/volume-provider.ts"

export type {
  AddonContext,
  AutoscalingRule,
  BootstrapPlan,
  Capability,
  ClusterConfigShape,
  ClusterTag,
  DesiredRecord,
  DistroKind,
  FlavorId,
  FlavorRef,
  ImageId,
  ImageRef,
  Inventory,
  Kubeconfig,
  K8sManifest,
  LbInfo,
  LbSpec,
  ManagedClusterInfo,
  ManagedClusterRef,
  NetworkInfo,
  NetworkSpec,
  NodeContext,
  NodeRef,
  NodeRole,
  ResolvedVersion,
  SecGroupInfo,
  SecGroupSpec,
  ServerInfo,
  ServerSpec,
  SshTarget,
  Version,
  VolumeInfo,
  VolumeRef,
  VolumeSpec,
  WorkerPoolShape
} from "./domain/types.ts"
