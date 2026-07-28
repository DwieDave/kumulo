import type { Effect } from "effect";
import { Context } from "effect"
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
import type {
  ClusterTag,
  FlavorId,
  FlavorRef,
  ImageId,
  ImageRef,
  Inventory,
  LbInfo,
  LbSpec,
  GatewayRef,
  NetworkInfo,
  NetworkSpec,
  SecGroupInfo,
  SecGroupSpec,
  ServerInfo,
  ServerSpec
} from "../domain/types.ts"

export type CloudError =
  | AuthenticationFailed
  | QuotaExceeded
  | ResourceNotFound
  | ResourceConflict
  | CapabilityMissing
  | ProvisioningTimeout
  | RateLimited
  | ProviderApiError
  | ResponseDecodeError
  | HttpTransportError

// The only interface the reconciler talks to for infrastructure.
export class CloudProvider extends Context.Service<CloudProvider, {
  readonly ensureNetwork: (spec: NetworkSpec) => Effect.Effect<NetworkInfo, CloudError>
  /**
   * Read-only counterpart of `ensureNetwork`: resolves the same network and
   * subnets, creating nothing. `undefined` means no such network yet.
   *
   * Exists so `plan` can compare a config's subnet CIDRs against the ids the
   * cluster was actually created on without writing (R8) — a mismatch is
   * unappliable on MKS, and the operator must see that before apply, not after.
   */
  readonly findNetwork: (spec: NetworkSpec) => Effect.Effect<NetworkInfo | undefined, CloudError>
  /**
   * Whether a gateway already exists for this cluster. Read-only: creating one
   * is OVH's API, not Neutron's, because only OVH's carries the tier — but a
   * gateway IS a Neutron router, so existence is answerable here.
   */
  readonly hasGateway: (spec: GatewayRef) => Effect.Effect<boolean, CloudError>
  readonly ensureSecurityGroups: (spec: SecGroupSpec) => Effect.Effect<SecGroupInfo, CloudError>
  readonly ensureLoadBalancer: (spec: LbSpec) => Effect.Effect<LbInfo, CloudError>
  readonly ensureServer: (spec: ServerSpec) => Effect.Effect<ServerInfo, CloudError>
  // Scale-down: deletes one orphaned worker VM (waits until it's
  // actually gone, so the caller can rely on the delete having landed).
  readonly deleteServer: (ref: ServerInfo) => Effect.Effect<void, CloudError>
  readonly deleteByTag: (tag: ClusterTag) => Effect.Effect<void, CloudError>
  readonly listClusterResources: (tag: ClusterTag) => Effect.Effect<Inventory, CloudError>
  readonly resolveImage: (ref: ImageRef) => Effect.Effect<ImageId, CloudError>
  readonly resolveFlavor: (ref: FlavorRef) => Effect.Effect<FlavorId, CloudError>
}>()("@kumulo/core/CloudProvider") {}
