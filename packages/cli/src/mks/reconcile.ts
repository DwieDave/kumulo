import { Effect } from "effect"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import { ConfigInvalid, ResourceNotFound } from "@kumulo/core"
import type { ClusterConfig, DnsProvider, Kubeconfig, ManagedClusterInfo, MksError } from "@kumulo/core"
import {
  deleteCluster,
  ensureCluster,
  ensureNodePools,
  fetchKubeconfig,
  findClusterByName,
  listNodePools,
  parseKubeVersion,
  type MksClusterConfig,
  type MksClusterRef,
  type MksWorkerPoolConfig
} from "@kumulo/distro-ovh-mks"
import { MksEnv } from "./env.ts"
import type { MksInventory } from "./plan.ts"
import { dnsProviderLayerFor, reconcileDns, removeDns } from "../dns.ts"

const _toPool = (pool: ClusterConfig["worker_pools"][number]): MksWorkerPoolConfig => ({
  name: pool.name,
  flavor: pool.flavor,
  desiredNodes: pool.count,
  minNodes: pool.autoscaling?.enabled ? pool.autoscaling.min : pool.count,
  maxNodes: pool.autoscaling?.enabled ? pool.autoscaling.max : pool.count,
  autoscale: pool.autoscaling?.enabled ?? false,
  antiAffinity: true,
  monthlyBilled: false
})

const _toMksConfig = (
  { config, serviceName }: { readonly config: ClusterConfig; readonly serviceName: string }
): MksClusterConfig => ({
  serviceName,
  name: config.name,
  region: config.auth.region,
  worker_pools: config.worker_pools.map(_toPool)
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
    if (info === undefined) return { clusterExists: false, poolNames: new Set<string>() }
    const pools = yield* listNodePools({ mks, ref: { serviceName, kubeId: info.id } })
    return { clusterExists: true, poolNames: new Set(pools.map((pool) => pool.name)) }
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

/** Converge control plane + nodepools onto the config, then its DNS records (create and scale share this). */
export const applyMksEffect = (
  config: ClusterConfig
): Effect.Effect<ManagedClusterInfo, MksError | ConfigInvalid, MksEnv | DnsProvider> =>
  Effect.gen(function*() {
    const { mks, serviceName } = yield* MksEnv
    const version = yield* parseKubeVersion(config.version)
    const mksConfig: MksClusterConfig = { ..._toMksConfig({ config, serviceName }), version }
    const info = yield* ensureCluster({ mks, config: mksConfig })
    const ref: MksClusterRef = { serviceName, kubeId: info.id }
    yield* ensureNodePools({ mks, ref, pools: mksConfig.worker_pools })
    yield* reconcileMksDns({ config, apiEndpoint: info.apiEndpoint })
    return info
  })

/** `applyMksEffect` wired to its live `DnsProvider`, `config.dns.module`-dispatched (R6). */
export const applyMks = (
  config: ClusterConfig
): Effect.Effect<ManagedClusterInfo, MksError | ConfigInvalid, MksEnv | HttpClient.HttpClient> =>
  applyMksEffect(config).pipe(Effect.provide(dnsProviderLayerFor(config)))

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
