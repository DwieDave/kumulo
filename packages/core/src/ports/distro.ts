import { Context, Effect } from "effect"
import type {
  AuthenticationFailed,
  BootstrapFailed,
  ConfigInvalid,
  HttpTransportError,
  ProvisioningTimeout,
  QuotaExceeded,
  ResourceConflict,
  ResourceNotFound,
  ResponseDecodeError
} from "../errors/tagged.ts"
import type {
  BootstrapPlan,
  ClusterConfigShape,
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

// Self-managed distros (k3s) drive the full phase pipeline
// themselves via cloud-init + SSH.
export interface SelfManagedDistroShape {
  readonly kind: "self-managed"
  readonly name: string
  readonly planBootstrap: (
    cluster: ClusterConfigShape,
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
  | ResourceNotFound
  | ResourceConflict
  | ProvisioningTimeout
  | QuotaExceeded
  | HttpTransportError
  | ResponseDecodeError

// Managed distros (ovh-mks) skip the infra phases; OVH runs
// the control plane and provisions nodes via its own API.
export interface ManagedDistroShape {
  readonly kind: "managed"
  readonly name: string
  readonly ensureCluster: (cfg: ClusterConfigShape) => Effect.Effect<ManagedClusterInfo, MksError>
  readonly ensureNodePools: (cfg: ClusterConfigShape) => Effect.Effect<void, MksError>
  readonly fetchKubeconfig: (ref: ManagedClusterRef) => Effect.Effect<Kubeconfig, MksError>
  readonly upgrade: (target: Version) => Effect.Effect<void, MksError>
  readonly delete: (ref: ManagedClusterRef) => Effect.Effect<void, MksError>
}

// Discriminated on `kind` — the reconciler branches once.
export type DistroShape = SelfManagedDistroShape | ManagedDistroShape

export class Distro extends Context.Service<Distro, DistroShape>()("@kumulo/core/Distro") {}
