import type { Effect } from "effect";
import { Context } from "effect"
import type {
  AuthenticationFailed,
  BootstrapFailed,
  CapabilityMissing,
  ConfigInvalid,
  HttpTransportError,
  ProviderApiError,
  ProvisioningTimeout,
  QuotaExceeded,
  RateLimited,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "../errors/tagged.ts"
import type {
  BootstrapPlan,
  ClusterConfigFields,
  Inventory,
  K8sManifest,
  Kubeconfig,
  ManagedClusterInfo,
  ManagedClusterRef,
  NodeContext,
  NodeRef,
  NodeRole,
  ResolvedVersion,
  SshTarget,
  Version
} from "../domain/types.ts"

export interface SelfManagedDistroService {
  readonly kind: "self-managed"
  readonly name: string
  readonly planBootstrap: (
    cluster: ClusterConfigFields,
    inventory: Inventory
  ) => Effect.Effect<BootstrapPlan>
  readonly renderUserData: (role: NodeRole, ctx: NodeContext) => Effect.Effect<string>
  readonly fetchKubeconfig: (
    entry: SshTarget,
    apiEndpoint: string
  ) => Effect.Effect<Kubeconfig, BootstrapFailed>
  readonly upgradePlan: (target: Version) => Effect.Effect<ReadonlyArray<K8sManifest>>
  readonly validateVersion: (v: string) => Effect.Effect<ResolvedVersion, ConfigInvalid>
  readonly drainAndRemove: (node: NodeRef) => Effect.Effect<void, BootstrapFailed>
}

export type MksError =
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

export interface ManagedDistroService {
  readonly kind: "managed"
  readonly name: string
  readonly ensureCluster: (cfg: ClusterConfigFields) => Effect.Effect<ManagedClusterInfo, MksError>
  readonly ensureNodePools: (cfg: ClusterConfigFields) => Effect.Effect<void, MksError>
  readonly fetchKubeconfig: (ref: ManagedClusterRef) => Effect.Effect<Kubeconfig, MksError>
  readonly upgrade: (target: Version) => Effect.Effect<void, MksError>
  readonly delete: (ref: ManagedClusterRef) => Effect.Effect<void, MksError>
}

export type DistroService = SelfManagedDistroService | ManagedDistroService

export class Distro extends Context.Service<Distro, DistroService>()("@kumulo/core/Distro") {}
