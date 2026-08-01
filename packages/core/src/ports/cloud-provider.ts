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

export class CloudProvider extends Context.Service<CloudProvider, {
  readonly ensureNetwork: (spec: NetworkSpec) => Effect.Effect<NetworkInfo, CloudError>
  readonly findNetwork: (spec: NetworkSpec) => Effect.Effect<NetworkInfo | undefined, CloudError>
  readonly hasGateway: (spec: GatewayRef) => Effect.Effect<boolean, CloudError>
  readonly ensureSecurityGroups: (spec: SecGroupSpec) => Effect.Effect<SecGroupInfo, CloudError>
  readonly ensureLoadBalancer: (spec: LbSpec) => Effect.Effect<LbInfo, CloudError>
  readonly ensureServer: (spec: ServerSpec) => Effect.Effect<ServerInfo, CloudError>
  // deleteServer blocks until the VM is actually gone
  readonly deleteServer: (ref: ServerInfo) => Effect.Effect<void, CloudError>
  readonly deleteByTag: (tag: ClusterTag) => Effect.Effect<void, CloudError>
  readonly listClusterResources: (tag: ClusterTag) => Effect.Effect<Inventory, CloudError>
  readonly resolveImage: (ref: ImageRef) => Effect.Effect<ImageId, CloudError>
  readonly resolveFlavor: (ref: FlavorRef) => Effect.Effect<FlavorId, CloudError>
}>()("@kumulo/core/CloudProvider") {}
