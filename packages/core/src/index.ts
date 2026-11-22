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

export { renderError } from "./errors/renderer.ts"

export type { RendererRegistry } from "./errors/renderer.ts"

export {
  AccessMode,
  Auth,
  AuthMethodSchema,
  authMethodsByProvider,
  Autoscaling,
  BucketName,
  Cidr,
  ClusterName,
  cidrRange,
  CinderVolumes,
  commonClusterFields,
  decodeConfigWith,
  Dns,
  manualDnsRecordsNeedZone,
  encodeConfigWith,
  HcloudVolumes,
  authMethodConsistentWithProvider,
  cdnOriginUrlRequired,
  type CrossFieldRule,
  crossFieldRule,
  isIpLiteral,
  BunnyBucketName,
  BunnyCdn,
  BunnyObjectStorage,
  BunnyStorageRegion,
  Cdn,
  CdnOrigin,
  Shield,
  secretsRequiredForObjectStorage,
  ManagedVolume,
  NonNegativeInt,
  NoVolumes,
  ObjectStorage,
  OpenStackVolumes,
  Outputs,
  OutputsFormat,
  parseConfigYamlWith,
  PositiveInt,
  ProviderSchema,
  Pvc,
  Secrets,
  stringifyConfigYaml,
  Volumes,
  WorkerPoolSchema
} from "./config/index.ts"

export type { AuthMethod, Provider, WorkerPool } from "./config/index.ts"

export { CloudProvider } from "./ports/cloud-provider.ts"

export type { CloudError } from "./ports/cloud-provider.ts"

export { CredentialsSink } from "./ports/credentials-sink.ts"

export type { ManagedDistroError } from "./ports/distro.ts"

export { DnsProvider } from "./ports/dns-provider.ts"

export type { DnsError } from "./ports/dns-provider.ts"

export { ObjectStorageProvider } from "./ports/object-storage-provider.ts"

export type { ObjectStorageError } from "./ports/object-storage-provider.ts"

export { ProviderProfile } from "./ports/provider-profile.ts"

export type { ProfileError } from "./ports/provider-profile.ts"

export { validateAutoscaling, validateCni } from "./ports/validation.ts"

export { distroCapabilities } from "./domain/capabilities.ts"

export type { DistroCapabilities } from "./domain/capabilities.ts"

export { VolumeProvider } from "./ports/volume-provider.ts"

export type { VolumeError } from "./ports/volume-provider.ts"

export { computePlan, CONFIG_HASH_KEY, configHash, serverConfigHash, namesToReplace, resourceName, toTaggedResource } from "./plan/index.ts"

export { createOrNoOp, deleteRow, PlanAction } from "./plan/index.ts"

export { paginate, paginateByOffset, paginateByPage, PaginationLimitExceeded, PaginationStalled } from "./paginate.ts"

export type { PaginateOptions, PaginationError } from "./paginate.ts"

export { makeOutputsFile, OutputsInvalid } from "./outputs/index.ts"

export type { OutputsFileOptions, OutputsLocation } from "./outputs/index.ts"

export { diffBuckets } from "./storage/diff.ts"

export type { BucketDiffResult } from "./storage/diff.ts"

export type { DesiredResource, Plan, TaggedResource } from "./plan/index.ts"

export { pollUntil } from "./reconcile/index.ts"

export type { PollOptions } from "./reconcile/index.ts"

export { decidePlanAction, PlanDecision } from "./present/index.ts"

export { genericProfile, genericProfileLive } from "./profiles/index.ts"

export { CdnProvider } from "./ports/cdn-provider.ts"

export type { CdnError } from "./ports/cdn-provider.ts"

export { cdnNoop, cdnNoopLive } from "./cdn-noop/index.ts"

export { dnsNoop, dnsNoopLive } from "./dns-noop/index.ts"

export { OWNERSHIP_PREFIX, ownedName, ownershipName, ownershipTarget, ownerTagOf, reconcileDns, reconcileDnsLive, recordKind } from "./dns/index.ts"

export type { DnsAdapter, DnsRecordKind, ZoneRecord } from "./dns/index.ts"

export { cordonNode, deleteNode, drainNode, installAddons, K8sClient, k8sClientFromKubeconfig, makeK8sClient, parseKubeconfig, refFor, waitForDeploymentAvailable } from "./k8s/index.ts"

export type { Addon, AddonError } from "./k8s/index.ts"

export type {
  ClientCertAuth,
  K8sClientFromKubeconfigOptions,
  K8sClientOptions,
  KubeconfigAuth,
  KubeconfigContext,
  ResourceRef,
  TokenAuth,
  WaitOptions
} from "./k8s/index.ts"

export type {
  AutoscalingRule,
  BootstrapPlan,
  AccessList,
  AccessListAction,
  AccessListType,
  BucketCredential,
  BucketInfo,
  CdnCacheMode,
  CdnTier,
  EdgeInfo,
  EdgeRef,
  EdgeSpec,
  RateLimitKey,
  RateLimitRule,
  SecurityPolicy,
  Sensitivity,
  ShieldPlan,
  WafMode,
  BucketRef,
  BucketSpec,
  ClusterConfigFields,
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
  GatewayRef,
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
  WorkerPoolFields
} from "./domain/types.ts"

export {
  classifyHttpError,
  HTTP_ERROR_BODY_LIMIT,
  ignoreNotFound,
  IDEMPOTENT_METHODS,
  makeProviderHttpClient,
  mapHttpError,
  parseRateLimitReset,
  parseRateLimitResetAt,
  parseRetryAfter,
  parseRetryAfterAt,
  truncateBody
} from "./http/index.ts"

export type {
  ClassifyOptions,
  HttpErrorContext,
  MapHttpErrorOptions,
  ProviderHttpClientOptions,
  RetryOptions
} from "./http/index.ts"
