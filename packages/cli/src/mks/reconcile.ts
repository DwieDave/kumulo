import { Effect } from "effect"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import { CloudProvider, ConfigInvalid, PlanRejected, ResourceConflict, ResourceNotFound } from "@kumulo/core"
import type { DnsProvider, Kubeconfig, LbInfo, ManagedClusterInfo, MksError, NetworkInfo, NetworkSpec } from "@kumulo/core"
import type { ClusterConfig } from "../cluster-config.ts"
import {
  clusterDrift,
  deleteCluster,
  driftConflict,
  ensureCluster,
  ensureNodePools,
  fetchKubeconfig,
  findClusterByName,
  listNodePools,
  parseKubeVersion,
  pollUntil,
  ensureGateway,
  requireVrack,
  type GatewayModel,
  type Mks,
  type MksDriverConfig,
  type MksClusterRef
} from "@kumulo/distro-ovh-mks"
import type { OpenStackEnv } from "../doctor-openstack/env.ts"
import { mksCloudProviderLayer } from "../provider/registry.ts"
import { withRowProgress } from "../spinner.ts"
import { MksEnv } from "./env.ts"
import type { MksInventory } from "./plan.ts"
import { mksClusterRow, mksPoolRow, toMksPool } from "./plan.ts"
import { dnsProviderLayerFor, reconcileDns, removeDns } from "../dns.ts"
import type { DnsTargets } from "../dns.ts"

const _toMksConfig = (
  { config, serviceName }: { readonly config: ClusterConfig; readonly serviceName: string }
): MksDriverConfig => ({
  serviceName,
  name: config.name,
  region: config.auth.region,
  worker_pools: config.worker_pools.map(toMksPool)
})

export const resolveMksNetwork = (config: ClusterConfig): Effect.Effect<NetworkInfo | undefined, MksError, CloudProvider> =>
  Effect.gen(function*() {
    const network = config.distro === "ovh-mks" ? config.network : undefined
    if (network === undefined) return undefined
    const cloud = yield* CloudProvider
    return yield* cloud.findNetwork(mksNetworkSpec(network))
  })

export const lookupMksInventory = (
  config: ClusterConfig
): Effect.Effect<Omit<MksInventory, "volumeNames">, MksError, MksEnv> =>
  Effect.gen(function*() {
    const { mks, serviceName } = yield* MksEnv
    const mksConfig = _toMksConfig({ config, serviceName })
    const info = yield* findClusterByName({ mks, config: mksConfig })
    if (info === undefined) return { clusterExists: false, poolNames: new Set<string>(), poolHashes: new Map() }
    const pools = yield* listNodePools({ mks, ref: { serviceName, kubeId: info.id } })
    return {
      clusterExists: true,
      poolNames: new Set(pools.map((pool) => pool.name)),
      poolHashes: new Map(pools.map((pool) => [pool.name, pool.configHash])),
      clusterState: {
        version: info.version,
        region: info.region,
        privateNetworkId: info.privateNetworkId,
        nodesSubnetId: info.nodesSubnetId,
        loadBalancersSubnetId: info.loadBalancersSubnetId
      }
    }
  })

const _endpointInvalid = (apiEndpoint: string) =>
  new ConfigInvalid({
    issues: [{ path: ["api_server"], message: `MKS apiEndpoint "${apiEndpoint}" has no hostname to point DNS at` }]
  })

const _dnsTargets = (
  { hostname, ingress }: { readonly hostname: string; readonly ingress: LbInfo | undefined }
): DnsTargets => ({
  api_server: { kind: "hostname", value: hostname },
  ...(ingress?.floatingIp === undefined || ingress.floatingIp === ""
    ? {}
    : { ingress: { kind: "ip" as const, value: ingress.floatingIp } })
})

export const reconcileMksDns = (
  { apiEndpoint, config, ingress }: {
    readonly config: ClusterConfig
    readonly apiEndpoint: string
    readonly ingress?: LbInfo
  }
): Effect.Effect<void, MksError | ConfigInvalid, DnsProvider> =>
  Effect.gen(function*() {
    // `none` short-circuits before the endpoint check.
    if (config.dns.module === "none") return
    const hostname = yield* Effect.try({
      try: () => new URL(apiEndpoint).hostname,
      catch: () => _endpointInvalid(apiEndpoint)
    })
    if (hostname === "") return yield* Effect.fail(_endpointInvalid(apiEndpoint))
    yield* reconcileDns({ config, targets: _dnsTargets({ hostname, ingress }) })
  })

type MksNetworkIds = Pick<MksDriverConfig, "privateNetworkId" | "nodesSubnetId" | "loadBalancersSubnetId">

const _RECREATE = "MKS sets a cluster's networking at creation and can never change it — " +
  "delete and recreate the cluster (and its network) deliberately, or revert the change"

// A missing subnet id fails here: MKS networking can never be corrected post-create (`Cloud_ProjectKubeUpdate` has no such field).
const _networkIds = (
  { info, spec }: { readonly info: NetworkInfo; readonly spec: NetworkSpec }
): Effect.Effect<MksNetworkIds, ResourceConflict> => {
  const missing = [
    ...(info.nodesSubnetId === undefined ? [`nodes_subnet ${spec.nodesSubnet}`] : []),
    ...(info.loadBalancersSubnetId === undefined ? [`load_balancers_subnet ${spec.loadBalancersSubnet}`] : [])
  ]
  return info.nodesSubnetId === undefined || info.loadBalancersSubnetId === undefined
    ? Effect.fail(
      new ResourceConflict({ kind: "network-drift", ref: `network ${info.id} has no subnet for ${missing.join(" or ")}; ${_RECREATE}` })
    )
    : Effect.succeed({
      privateNetworkId: info.id,
      nodesSubnetId: info.nodesSubnetId,
      loadBalancersSubnetId: info.loadBalancersSubnetId
    })
}

// Refusal hoisted ahead of the first Neutron write — a later refusal would already have created the network and subnets, orphaning them.
const _refuseClusterDrift = (
  { config, mks, serviceName }: { readonly config: ClusterConfig; readonly mks: Mks; readonly serviceName: string }
): Effect.Effect<void, MksError> =>
  Effect.gen(function*() {
    const actual = yield* findClusterByName({ mks, config: _toMksConfig({ config, serviceName }) })
    if (actual === undefined) return
    const drift = clusterDrift({ desired: { region: config.auth.region, privateNetwork: true }, actual })
    if (drift._tag === "Blocked") return yield* Effect.fail(driftConflict(drift))
  })

const _ensureMksNetwork = (
  { config, mks, serviceName }: {
    readonly config: ClusterConfig
    readonly mks: Mks
    readonly serviceName: string
  }
): Effect.Effect<MksNetworkIds, MksError, CloudProvider> =>
  Effect.gen(function*() {
    const network = config.distro === "ovh-mks" ? config.network : undefined
    if (network === undefined) return {}
    yield* _refuseClusterDrift({ config, mks, serviceName })
    yield* requireVrack({ mks, region: config.auth.region, serviceName })
    const cloud = yield* CloudProvider
    const spec = mksNetworkSpec(network)
    const ids = yield* _networkIds({ info: yield* cloud.ensureNetwork(spec), spec })
    yield* _ensureMksGateway({ config, ids, mks, network, serviceName })
    return ids
  })

// Created through OVH's API (has the `model`/tier field); existence is checked via Neutron since an OVH gateway IS a Neutron router.
const _ensureMksGateway = (
  { config, ids, mks, network, serviceName }: {
    readonly config: ClusterConfig
    readonly ids: MksNetworkIds
    readonly mks: Mks
    readonly network: { readonly gateway_model?: GatewayModel }
    readonly serviceName: string
  }
): Effect.Effect<void, MksError, CloudProvider> =>
  Effect.gen(function*() {
    const cloud = yield* CloudProvider
    const name = `kumulo-${config.name}`
    if (yield* cloud.hasGateway({ name })) return
    if (ids.privateNetworkId === undefined || ids.nodesSubnetId === undefined) return
    yield* ensureGateway({
      mks,
      serviceName,
      region: config.auth.region,
      networkId: ids.privateNetworkId,
      subnetId: ids.nodesSubnetId,
      name,
      model: network.gateway_model ?? "s"
    })
  })

export const mksNetworkSpec = (
  network: { readonly cidr: string; readonly nodes_subnet: string; readonly load_balancers_subnet: string }
): NetworkSpec => ({
  cidr: network.cidr,
  nodesSubnet: network.nodes_subnet,
  loadBalancersSubnet: network.load_balancers_subnet
})

// Creates an EMPTY LB — listeners/pools/members belong to cloud-controller-manager once a Service adopts it, so re-running is a no-op.
const _ensureMksIngress = (
  { config, network }: { readonly config: ClusterConfig; readonly network: MksNetworkIds }
): Effect.Effect<LbInfo | undefined, MksError, CloudProvider> =>
  Effect.gen(function*() {
    const ingress = config.distro === "ovh-mks" ? config.ingress : undefined
    if (ingress === undefined) return undefined
    const cloud = yield* CloudProvider
    return yield* cloud.ensureLoadBalancer({
      members: [],
      floatingIp: true,
      ...(network.privateNetworkId === undefined ? {} : { vipNetworkId: network.privateNetworkId }),
      ...(network.loadBalancersSubnetId === undefined ? {} : { vipSubnetId: network.loadBalancersSubnetId }),
      ...(ingress.flavor_id === undefined ? {} : { flavorId: ingress.flavor_id }),
      ...(ingress.flavor === undefined ? {} : { flavorName: ingress.flavor })
    })
  })

const NO_REPLACE: ReadonlySet<string> = new Set()

// mks-cluster/<name> can only be "replaced" by deleting the cluster and every workload on it — refused outright.
const _poolsToReplace = (
  { config, replace }: { readonly config: ClusterConfig; readonly replace: ReadonlySet<string> }
): Effect.Effect<ReadonlySet<string>, PlanRejected> => {
  if (replace.has(mksClusterRow(config.name))) {
    return Effect.fail(
      new PlanRejected({
        reason:
          `the MKS control plane cannot be replaced in place (${mksClusterRow(config.name)}): OVH manages it, so replacing it means ` +
          `deleting the cluster and everything on it. Delete and recreate it deliberately, or revert the change.`
      })
    )
  }
  const byRow = new Map(config.worker_pools.map((pool) => [mksPoolRow({ cluster: config.name, pool: pool.name }), pool.name]))
  return Effect.succeed(new Set([...replace].flatMap((row) => byRow.get(row) ?? [])))
}

export interface MksApplyResult extends ManagedClusterInfo {
  readonly ingress?: LbInfo
}

export const applyMksEffect = (
  { config, replace = NO_REPLACE }: {
    readonly config: ClusterConfig
    readonly replace?: ReadonlySet<string>
  }
): Effect.Effect<MksApplyResult, MksError | ConfigInvalid | PlanRejected, MksEnv | DnsProvider | CloudProvider> =>
  Effect.gen(function*() {
    const pools = yield* _poolsToReplace({ config, replace })
    const { mks, serviceName } = yield* MksEnv
    const version = yield* parseKubeVersion(config.version)
    const network = yield* withRowProgress({
      match: (name) => name.startsWith("network/") || name.startsWith("subnet/") || name.startsWith("gateway/"),
      effect: _ensureMksNetwork({ config, mks, serviceName })
    })
    const mksConfig: MksDriverConfig = { ..._toMksConfig({ config, serviceName }), version, ...network }
    const info = yield* withRowProgress({
      match: (name) => name.startsWith("mks-cluster/"),
      effect: ensureCluster({ mks, config: mksConfig })
    })
    const ref: MksClusterRef = { serviceName, kubeId: info.id }
    yield* withRowProgress({
      match: (name) => name.startsWith("mks-pool/"),
      effect: ensureNodePools({ mks, ref, pools: mksConfig.worker_pools, replace: pools })
    })
    const ingress = yield* withRowProgress({
      match: (name) => name.startsWith("load-balancer/") || name.startsWith("floating-ip/"),
      effect: _ensureMksIngress({ config, network })
    })
    yield* reconcileMksDns({ config, apiEndpoint: info.apiEndpoint, ingress })
    return { ...info, ...(ingress === undefined ? {} : { ingress }) }
  })

export const applyMks = (
  args: { readonly config: ClusterConfig; readonly replace?: ReadonlySet<string> }
): Effect.Effect<MksApplyResult, MksError | ConfigInvalid | PlanRejected, MksEnv | OpenStackEnv | HttpClient.HttpClient> =>
  applyMksEffect(args).pipe(
    Effect.provide(dnsProviderLayerFor(args.config)),
    Effect.provide(mksCloudProviderLayer(args.config))
  )

export const kubeconfigMks = (
  config: ClusterConfig
): Effect.Effect<Kubeconfig, MksError, MksEnv> =>
  Effect.gen(function*() {
    const { mks, serviceName } = yield* MksEnv
    const mksConfig = _toMksConfig({ config, serviceName })
    const info = yield* findClusterByName({ mks, config: mksConfig })
    if (info === undefined) {
      return yield* Effect.fail(new ResourceNotFound({ kind: "kube", ref: config.name }))
    }
    return yield* fetchKubeconfig({ mks, ref: { serviceName, kubeId: info.id } })
  })

// OVH's delete call returns before node VMs are gone; deleting the network first is a guaranteed 409, so teardown blocks here.
const _waitClusterGone = (
  { config, mks, serviceName }: { readonly config: ClusterConfig; readonly mks: Mks; readonly serviceName: string }
): Effect.Effect<void, MksError> =>
  pollUntil({
    check: findClusterByName({ mks, config: _toMksConfig({ config, serviceName }) }).pipe(
      Effect.map((info) => info?.status ?? "DELETED")
    ),
    isDone: (status) => status === "DELETED",
    interval: "5 seconds",
    timeout: "20 minutes",
    ref: config.name
  }).pipe(Effect.asVoid)

const _deleteMksInfra = (config: ClusterConfig): Effect.Effect<void, MksError, CloudProvider> =>
  Effect.gen(function*() {
    if (config.distro !== "ovh-mks" || config.network === undefined) return
    const cloud = yield* CloudProvider
    yield* cloud.deleteByTag(config.name)
  })

export const deleteMksEffect = (config: ClusterConfig): Effect.Effect<void, MksError, MksEnv | DnsProvider | CloudProvider> =>
  Effect.gen(function*() {
    const { mks, serviceName } = yield* MksEnv
    const mksConfig = _toMksConfig({ config, serviceName })
    yield* removeDns(config)
    yield* withRowProgress({
      match: (name) => name.startsWith("mks-cluster/") || name.startsWith("mks-pool/"),
      effect: Effect.gen(function*() {
        const info = yield* findClusterByName({ mks, config: mksConfig })
        if (info !== undefined) {
          yield* deleteCluster({ mks, ref: { serviceName, kubeId: info.id } })
          yield* _waitClusterGone({ config, mks, serviceName })
        }
      })
    })
    yield* withRowProgress({
      match: (name) =>
        name.startsWith("network/") || name.startsWith("subnet/") || name.startsWith("gateway/") ||
        name.startsWith("load-balancer/") || name.startsWith("floating-ip/"),
      effect: _deleteMksInfra(config)
    })
  })

export const deleteMks = (
  config: ClusterConfig
): Effect.Effect<void, MksError | ConfigInvalid, MksEnv | OpenStackEnv | HttpClient.HttpClient> =>
  deleteMksEffect(config).pipe(
    Effect.provide(dnsProviderLayerFor(config)),
    Effect.provide(mksCloudProviderLayer(config))
  )
