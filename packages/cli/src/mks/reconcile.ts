import { Effect } from "effect"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import { CloudProvider, ConfigInvalid, PlanRejected, ResourceConflict, ResourceNotFound } from "@kumulo/core"
import type {
  ClusterConfig,
  DnsProvider,
  Kubeconfig,
  ManagedClusterInfo,
  MksError,
  NetworkInfo,
  NetworkSpec
} from "@kumulo/core"
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
  requireVrack,
  type Mks,
  type MksClusterConfig,
  type MksClusterRef
} from "@kumulo/distro-ovh-mks"
import type { OpenStackEnv } from "../doctor-openstack/env.ts"
import { mksCloudProviderLayer } from "../provider/registry.ts"
import { MksEnv } from "./env.ts"
import type { MksInventory } from "./plan.ts"
import { mksClusterRow, mksPoolRow, toMksPool } from "./plan.ts"
import { dnsProviderLayerFor, reconcileDns, removeDns } from "../dns.ts"

const _toMksConfig = (
  { config, serviceName }: { readonly config: ClusterConfig; readonly serviceName: string }
): MksClusterConfig => ({
  serviceName,
  name: config.name,
  region: config.auth.region,
  worker_pools: config.worker_pools.map(toMksPool)
})

/**
 * Live cluster/nodepool existence for the plan. `volumeNames` is filled in by
 * the caller (a Cinder lookup lives in `commands/volumes.ts`, not here).
 */
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
      clusterState: { version: info.version, region: info.region, privateNetworkId: info.privateNetworkId }
    }
  })

const _endpointInvalid = (apiEndpoint: string) =>
  new ConfigInvalid({
    issues: [{ path: ["api_server"], message: `MKS apiEndpoint "${apiEndpoint}" has no hostname to point DNS at` }]
  })

/**
 * MKS DNS phase: the managed control plane is only ever reachable by name, so
 * `api_server` becomes a CNAME to `apiEndpoint`'s hostname (D3). An endpoint we
 * can't parse a hostname out of fails loudly rather than skipping DNS silently.
 */
export const reconcileMksDns = (
  { apiEndpoint, config }: { readonly config: ClusterConfig; readonly apiEndpoint: string }
): Effect.Effect<void, MksError | ConfigInvalid, DnsProvider> =>
  Effect.gen(function*() {
    // ponytail: `none` short-circuits before the endpoint check — no records to
    // write, so an endpoint we can't parse isn't a failure for that config.
    if (config.dns.module === "none") return
    const hostname = yield* Effect.try({
      try: () => new URL(apiEndpoint).hostname,
      catch: () => _endpointInvalid(apiEndpoint)
    })
    if (hostname === "") return yield* Effect.fail(_endpointInvalid(apiEndpoint))
    yield* reconcileDns({ config, apiTarget: { kind: "hostname", value: hostname } })
  })

/** The creation-time network ids MKS accepts, all three or none (R6). */
type MksNetworkIds = Pick<MksClusterConfig, "privateNetworkId" | "nodesSubnetId" | "loadBalancersSubnetId">

const _RECREATE = "MKS sets a cluster's networking at creation and can never change it — " +
  "delete and recreate the cluster (and its network) deliberately, or revert the change"

/**
 * `ensureNetwork` omits a subnet id rather than reporting `""` when its
 * read-back didn't find the subnet. Half a network would produce a cluster
 * whose networking can never be corrected (`Cloud_ProjectKubeUpdate` is
 * `{ name?, updatePolicy? }`), so a missing id fails here instead.
 *
 * This is also where an edited subnet CIDR lands: kumulo never re-subnets a
 * network that already exists, so the new CIDR resolves to no subnet at all.
 * Plan time compares network *presence* only (the desired ids are unknowable
 * before the network exists), so this message has to name the field itself.
 */
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

/**
 * R8's refusal, hoisted ahead of the first Neutron write. `_convergeCluster`
 * makes the same call, but only once `ensureNetwork` has already created the
 * network and both subnets — and M2 ships no teardown, so they would be
 * orphaned for good. Read-only, so a refusal still costs zero mutations.
 */
const _refuseClusterDrift = (
  { config, mks, serviceName }: { readonly config: ClusterConfig; readonly mks: Mks; readonly serviceName: string }
): Effect.Effect<void, MksError> =>
  Effect.gen(function*() {
    const actual = yield* findClusterByName({ mks, config: _toMksConfig({ config, serviceName }) })
    if (actual === undefined) return
    const drift = clusterDrift({ desired: { region: config.auth.region, privateNetwork: true }, actual })
    if (drift._tag === "Blocked") return yield* Effect.fail(driftConflict(drift))
  })

/**
 * The network, reconciled before the cluster (R7) — its ids are creation-time
 * inputs to `Cloud_ProjectKubeCreation`. Gated on the `network` block, so a
 * config that asks for none keeps today's behaviour and never reaches
 * `requireVrack` (R5): ungated, that read would refuse every MKS apply on a
 * vRack-less project. Both preconditions are read-only and run first, so a
 * refusal costs zero mutations.
 */
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
    const spec: NetworkSpec = {
      cidr: network.cidr,
      nodesSubnet: network.nodes_subnet,
      loadBalancersSubnet: network.load_balancers_subnet
    }
    return yield* _networkIds({ info: yield* cloud.ensureNetwork(spec), spec })
  })

const NO_REPLACE: ReadonlySet<string> = new Set()

/**
 * Confirmed plan rows → the pool names `ensureNodePools` may destroy.
 *
 * MKS runs the control plane itself, so there is no master analogue to
 * replace: `mks-cluster/<name>` can only be "replaced" by deleting the
 * cluster (and every workload on it). That is refused outright — the same
 * stance `_refuseMasterReplace` takes for k3s etcd quorum. Rows this distro
 * doesn't own (`bucket/`, `volume/`) belong to their own reconcilers and are
 * ignored here, exactly as the k3s path ignores non-server rows.
 */
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

/** Converge control plane + nodepools onto the config, then its DNS records (create and scale share this). */
export const applyMksEffect = (
  { config, replace = NO_REPLACE }: {
    readonly config: ClusterConfig
    /** Node pools the operator confirmed for replacement (plan `ReplaceNeedsConfirm` rows). */
    readonly replace?: ReadonlySet<string>
  }
): Effect.Effect<ManagedClusterInfo, MksError | ConfigInvalid | PlanRejected, MksEnv | DnsProvider | CloudProvider> =>
  Effect.gen(function*() {
    const pools = yield* _poolsToReplace({ config, replace })
    const { mks, serviceName } = yield* MksEnv
    const version = yield* parseKubeVersion(config.version)
    const network = yield* _ensureMksNetwork({ config, mks, serviceName })
    const mksConfig: MksClusterConfig = { ..._toMksConfig({ config, serviceName }), version, ...network }
    const info = yield* ensureCluster({ mks, config: mksConfig })
    const ref: MksClusterRef = { serviceName, kubeId: info.id }
    yield* ensureNodePools({ mks, ref, pools: mksConfig.worker_pools, replace: pools })
    yield* reconcileMksDns({ config, apiEndpoint: info.apiEndpoint })
    return info
  })

/**
 * `applyMksEffect` wired to its live `DnsProvider` (`config.dns.module`-dispatched, R6)
 * and OpenStack `CloudProvider`. The latter is only ever reached by a config
 * carrying a `network` block, so OS_* credentials stay optional on this path
 * until one is declared — the Layer is built either way, and every verb on it
 * fails at *first use* rather than at build time (R5). Anything else refuses
 * every existing OVH-only MKS apply.
 */
export const applyMks = (
  args: { readonly config: ClusterConfig; readonly replace?: ReadonlySet<string> }
): Effect.Effect<ManagedClusterInfo, MksError | ConfigInvalid | PlanRejected, MksEnv | OpenStackEnv | HttpClient.HttpClient> =>
  applyMksEffect(args).pipe(
    Effect.provide(dnsProviderLayerFor(args.config)),
    Effect.provide(mksCloudProviderLayer(args.config))
  )

/** Kubeconfig via the OVH API; resolves the cluster by name first (stateless), never creates one. */
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

/** Delete: resolves the cluster by name (idempotent lookup); missing cluster is a no-op, never provisions one. */
export const deleteMksEffect = (config: ClusterConfig): Effect.Effect<void, MksError, MksEnv | DnsProvider> =>
  Effect.gen(function*() {
    const { mks, serviceName } = yield* MksEnv
    const mksConfig = _toMksConfig({ config, serviceName })
    yield* removeDns(config)
    const info = yield* findClusterByName({ mks, config: mksConfig })
    if (info === undefined) return
    yield* deleteCluster({ mks, ref: { serviceName, kubeId: info.id } })
  })

/** `deleteMksEffect` wired to its live `DnsProvider` (mirrors `deleteK3s`). */
export const deleteMks = (
  config: ClusterConfig
): Effect.Effect<void, MksError | ConfigInvalid, MksEnv | HttpClient.HttpClient> =>
  deleteMksEffect(config).pipe(Effect.provide(dnsProviderLayerFor(config)))
