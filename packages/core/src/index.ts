export const packageName = "@kumulo/core"

export {
  AddonInstallFailed,
  AuthenticationFailed,
  BootstrapFailed,
  BucketNotEmpty,
  CapabilityMissing,
  ConfigInvalid,
  HttpTransportError,
  PlanRejected,
  ProviderApiError,
  ProvisioningTimeout,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError,
  SinkUnavailable
} from "./errors/tagged.ts"
export type { CredentialsSinkError, KumuloError, KumuloErrorTag, PathedIssue } from "./errors/tagged.ts"
export { isRetryable } from "./errors/retryable.ts"
export { renderError } from "./errors/renderer.ts"
export type { RendererRegistry } from "./errors/renderer.ts"

export {
  ClusterConfig,
  decodeConfig,
  encodeConfig,
  K3sClusterConfig,
  MksClusterConfig,
  OutputsFormat,
  parseConfigYaml,
  stringifyConfigYaml
} from "./config/index.ts"
export type {
  ClusterConfigEncoded,
  K3sClusterConfigEncoded,
  MksClusterConfigEncoded,
  WorkerPool
} from "./config/index.ts"

export { Addon } from "./ports/addon.ts"
export type { AddonError } from "./ports/addon.ts"
export { CloudProvider } from "./ports/cloud-provider.ts"
export type { CloudError } from "./ports/cloud-provider.ts"
export { CredentialsSink } from "./ports/credentials-sink.ts"
export { Distro } from "./ports/distro.ts"
export type { DistroShape, ManagedDistroShape, MksError, SelfManagedDistroShape } from "./ports/distro.ts"
export { DnsProvider } from "./ports/dns-provider.ts"
export type { DnsError } from "./ports/dns-provider.ts"
export { ObjectStorageProvider } from "./ports/object-storage-provider.ts"
export type { ObjectStorageError } from "./ports/object-storage-provider.ts"
export { ProviderProfile } from "./ports/provider-profile.ts"
export type { AuthDefaults, ProfileError } from "./ports/provider-profile.ts"
export { validateAutoscaling, validateCni } from "./ports/validation.ts"
export { distroCapabilities } from "./domain/capabilities.ts"
export type { DistroCapabilities } from "./domain/capabilities.ts"
export { VolumeProvider } from "./ports/volume-provider.ts"
export type { VolumeError } from "./ports/volume-provider.ts"

export { computePlan, CONFIG_HASH_KEY, configHash, namesToReplace, resourceName, toTaggedResource } from "./plan/index.ts"
export type { DesiredResource, Plan, PlanAction, TaggedResource } from "./plan/index.ts"

export { applyServers, pollUntil } from "./reconcile/index.ts"
export type { PollOptions } from "./reconcile/index.ts"

// The CLI's colored `present.ts` is what users see; core's plain `renderPlan`
// is the uncolored one used for snapshot tests (examples/plan-snapshot.test.ts).
export { decidePlanAction, renderPlan } from "./present/index.ts"
export type { PlanDecision } from "./present/index.ts"

export { genericProfile, genericProfileLive } from "./profiles/index.ts"

export { dnsNoop, dnsNoopLive } from "./dns-noop/index.ts"

export { OWNERSHIP_PREFIX, ownershipTarget, ownerTagOf, recordKind } from "./dns/index.ts"
export type { DnsRecordKind } from "./dns/index.ts"

export { cordonNode, deleteNode, drainNode, K8sClient, makeK8sClient, parseKubeconfig, waitForDeploymentAvailable, waitForNodeReady } from "./k8s/index.ts"
export type {
  ClientCertAuth,
  K8sClientOptions,
  KubeconfigAuth,
  KubeconfigContext,
  ResourceRef,
  TokenAuth,
  WaitOptions
} from "./k8s/index.ts"

export type {
  AddonContext,
  AutoscalingRule,
  BootstrapPlan,
  BucketInfo,
  BucketRef,
  BucketSpec,
  Capability,
  ClusterConfigShape,
  ClusterTag,
  CredentialEntry,
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
  S3Credentials,
  SecGroupInfo,
  SecGroupRule,
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
