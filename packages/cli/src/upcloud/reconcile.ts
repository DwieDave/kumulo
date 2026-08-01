import { Console, Effect } from "effect"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import type { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import type { ChildProcessSpawner as ChildProcessSpawnerNS } from "effect/unstable/process"
import { ConfigInvalid, parseKubeconfig, PlanRejected, ResourceNotFound } from "@kumulo/core"
import type { CredentialsSinkError, DnsError, DnsProvider, Kubeconfig, MksError, ObjectStorageError, VolumeError } from "@kumulo/core"
import type { UpcloudUksClusterConfig } from "../cluster-config.ts"
import {
  deleteCluster,
  deleteNetwork,
  ensureCluster,
  ensureNetwork,
  ensureNodePools,
  fetchKubeconfig,
  findClusterByName,
  upgradeCluster
} from "@kumulo/distro-upcloud-uks"
import type { UksClusterConfig, UksClusterInfo } from "@kumulo/distro-upcloud-uks"
import { toUksPool, uksClusterRow, uksPoolRow } from "./plan.ts"
import { UpcloudEnv } from "./env.ts"
import { dnsProviderLayerFor, reconcileDns, removeDns } from "../dns.ts"
import type { DistroUpgradeArgs } from "../distro/types.ts"
import { convergeUpcloudBuckets, reconcileUpcloudObjectStorageOnDelete } from "./storage.ts"
import { convergeUpcloudVolumes, managedUpcloudVolumes, reconcileUpcloudVolumesOnDelete } from "./volumes.ts"

// kumulo: `UksClients`'s `ensureCluster`/`ensureNodePools` stamp an `owner`
// label (T4.5/D14). There is no multi-operator identity concept anywhere else
// in kumulo — every distro's ownership marker is a fixed string (see
// `distro-upcloud-uks`'s own `lifecycle.test.ts`), so this mirrors that rather
// than inventing a per-install identity.
const OWNER = "kumulo"

const _toUksConfig = (config: UpcloudUksClusterConfig): UksClusterConfig => ({
  name: config.name,
  zone: config.zone,
  version: config.version,
  plan: config.plan,
  network: { cidr: config.network.cidr },
  worker_pools: config.worker_pools.map(toUksPool),
  control_plane_ip_filter: config.control_plane_ip_filter,
  storage_encryption: config.storage_encryption
  // `upgrade_strategy` deliberately omitted: `ensureCluster`/`ensureNodePools`
  // never read it (grep confirms), and its vocabulary (LATEST_PATCH/NEXT_MINOR)
  // doesn't match the config's (manual/rolling-update) — that one reaches
  // `upgradeCluster` directly, from the explicit `upgrade` verb below.
})

/**
 * Confirmed plan rows → the pool names `ensureNodePools` may destroy. Refuses
 * outright when the control plane row itself was confirmed for replace — UpCloud
 * runs it, so "replacing" it means deleting the cluster and everything on it
 * (mirrors `mks/reconcile.ts`'s `_poolsToReplace`).
 */
const _poolsToReplace = (
  { config, replace }: { readonly config: UpcloudUksClusterConfig; readonly replace: ReadonlySet<string> }
): Effect.Effect<ReadonlySet<string>, PlanRejected> => {
  if (replace.has(uksClusterRow(config.name))) {
    return Effect.fail(
      new PlanRejected({
        reason: `the UKS control plane cannot be replaced in place (${
          uksClusterRow(config.name)
        }): UpCloud manages it, so replacing it means deleting the cluster and everything on it. Delete and recreate it deliberately, or revert the change.`
      })
    )
  }
  const byRow = new Map(config.worker_pools.map((pool) => [uksPoolRow({ cluster: config.name, pool: pool.name }), pool.name]))
  return Effect.succeed(new Set([...replace].flatMap((row) => byRow.get(row) ?? [])))
}

/** Converge network, control plane, then node pools onto the config (create and scale share this). */
export const applyUpcloudUksEffect = (
  { config, replace }: { readonly config: UpcloudUksClusterConfig; readonly replace: ReadonlySet<string> }
): Effect.Effect<
  UksClusterInfo,
  MksError | PlanRejected | ConfigInvalid | VolumeError | ObjectStorageError | CredentialsSinkError | PlatformError,
  UpcloudEnv | DnsProvider | FileSystem | ChildProcessSpawnerNS.ChildProcessSpawner | HttpClient.HttpClient
> =>
  Effect.gen(function*() {
    const pools = yield* _poolsToReplace({ config, replace })
    const { clients } = yield* UpcloudEnv
    const network = yield* ensureNetwork({ clients, clusterName: config.name, zone: config.zone, cidr: config.network.cidr })
    const info = yield* ensureCluster({ clients, config: _toUksConfig(config), networkUuid: network.networkUuid, owner: OWNER })
    yield* ensureNodePools({
      clients,
      ref: { uuid: info.uuid, name: info.name },
      pools: config.worker_pools.map(toUksPool),
      owner: OWNER,
      replace: pools
    })
    // D4: the DNS phase runs inside apply, as it does for mks and k3s. The
    // kubeconfig is fetched only when a zone is actually declared, or
    // T6.1's volumes need it to apply PV/PVC manifests — an extra API call
    // and (for DNS) a secret, neither worth handling for `module: none`.
    const managedVolumes = managedUpcloudVolumes(config)
    if (config.dns.module !== "none" || managedVolumes.length > 0) {
      const kubeconfig = yield* fetchKubeconfig({ clients, uuid: info.uuid })
      if (config.dns.module !== "none") yield* reconcileUpcloudDns({ config, kubeconfig })
      if (managedVolumes.length > 0) yield* convergeUpcloudVolumes({ config, kubeconfig })
    }
    // T6.1: buckets have no dependency on the cluster/kubeconfig — the D6
    // service rides the cluster's SDN network (D6), not its k8s API.
    yield* convergeUpcloudBuckets(config)
    return info
  })

/** `applyUpcloudUksEffect` wired to its live `DnsProvider` (`config.dns.module`-dispatched, R6). */
export const applyUpcloudUks = (
  args: { readonly config: UpcloudUksClusterConfig; readonly replace: ReadonlySet<string> }
): Effect.Effect<
  UksClusterInfo,
  MksError | PlanRejected | ConfigInvalid | VolumeError | ObjectStorageError | CredentialsSinkError | PlatformError,
  UpcloudEnv | HttpClient.HttpClient | FileSystem | ChildProcessSpawnerNS.ChildProcessSpawner
> => applyUpcloudUksEffect(args).pipe(Effect.provide(dnsProviderLayerFor(args.config)))

/**
 * UKS DNS phase (D4). UpCloud's cluster response carries no endpoint field —
 * unlike MKS, whose `apiEndpoint` `reconcileMksDns` parses — so the API server's
 * hostname comes from the kubeconfig's `cluster.server` URL, the only place
 * UpCloud states it.
 *
 * kumulo: no `ingress` target. UKS load balancers are a Service-level concern
 * owned by UpCloud's cloud-controller-manager, and kumulo declares no ingress
 * block for this distro (scope.md leaves it out of the first cut).
 */
export const reconcileUpcloudDns = (
  { config, kubeconfig }: { readonly config: UpcloudUksClusterConfig; readonly kubeconfig: Kubeconfig }
): Effect.Effect<void, DnsError | ConfigInvalid, DnsProvider> =>
  Effect.gen(function*() {
    if (config.dns.module === "none") return
    const context = yield* parseKubeconfig(kubeconfig.content)
    const hostname = yield* Effect.try({
      try: () => new URL(context.server).hostname,
      catch: () => _serverInvalid(context.server)
    })
    if (hostname === "") return yield* Effect.fail(_serverInvalid(context.server))
    yield* reconcileDns({ config, targets: { api_server: { kind: "hostname", value: hostname } } })
  })

const _serverInvalid = (server: string): ConfigInvalid =>
  new ConfigInvalid({
    issues: [{ path: ["dns"], message: `kubeconfig cluster.server "${server}" has no hostname to point a DNS record at` }]
  })

/** Kubeconfig via the UpCloud API; resolves the cluster by name first (stateless), never creates one. */
export const kubeconfigUpcloudUks = (
  config: UpcloudUksClusterConfig
): Effect.Effect<Kubeconfig, MksError, UpcloudEnv> =>
  Effect.gen(function*() {
    const { clients } = yield* UpcloudEnv
    const info = yield* findClusterByName({ clients, name: config.name })
    if (info === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "kube", ref: config.name }))
    return yield* fetchKubeconfig({ clients, uuid: info.uuid })
  })

/**
 * Delete: resolves the cluster by name (idempotent lookup) — missing cluster is
 * a no-op, never provisions one. Router+network teardown always runs (D3/T5.2:
 * fully reproducible from `cluster.json`, so there is no `retain` case).
 */
/**
 * D9 ordering: object-storage service (`?force=true` only when every
 * configured bucket is `retain: false`) → non-retained volumes (detach
 * checked by the API's own conflict) → cluster → network → router. Retained
 * buckets/volumes are reported by their reconcile functions, not deleted;
 * this function itself only orders the steps, it never inspects `kept`.
 */
const _deleteUpcloudUksEffect = (
  config: UpcloudUksClusterConfig
): Effect.Effect<void, MksError | ConfigInvalid | ObjectStorageError | VolumeError, UpcloudEnv | DnsProvider> =>
  Effect.gen(function*() {
    yield* reconcileUpcloudObjectStorageOnDelete(config)
    yield* reconcileUpcloudVolumesOnDelete(config)
    const { clients } = yield* UpcloudEnv
    const info = yield* findClusterByName({ clients, name: config.name })
    if (info !== undefined) {
      yield* deleteCluster({ clients, ref: { uuid: info.uuid, name: info.name } })
    }
    yield* deleteNetwork({ clients, clusterName: config.name })
    yield* removeDns(config)
  })

/** `_deleteUpcloudUksEffect` wired to its live `DnsProvider`, mirroring `applyUpcloudUks`. */
export const deleteUpcloudUks = (
  config: UpcloudUksClusterConfig
): Effect.Effect<void, MksError | ConfigInvalid | ObjectStorageError | VolumeError, UpcloudEnv | HttpClient.HttpClient> =>
  _deleteUpcloudUksEffect(config).pipe(Effect.provide(dnsProviderLayerFor(config)))

export const statusUpcloudUks = Effect.fn(function*(config: UpcloudUksClusterConfig) {
  const { clients } = yield* UpcloudEnv
  const info = yield* findClusterByName({ clients, name: config.name })
  if (info === undefined) {
    yield* Console.log(`Cluster "${config.name}" does not exist.`)
    return
  }
  const pools = config.worker_pools.map((pool) => `${pool.name} (x${pool.count})`).join(", ") || "(none)"
  yield* Console.log(
    [`Cluster "${config.name}": ${info.status}`, `  Zone: ${info.zone}`, `  Worker pools: ${pools}`].join("\n")
  )
})

/**
 * UpCloud's `/upgrade` endpoint takes a target version, not a strategy name
 * (D12) — `resolveUpgradeTarget` (inside `upgradeCluster`) resolves the CLI's
 * distro-agnostic `strategy` against `available-upgrades` first.
 */
export const upgradeUpcloudUks = (
  { config, strategy, yes }: DistroUpgradeArgs<UpcloudUksClusterConfig>
): Effect.Effect<void, MksError | ResourceNotFound, UpcloudEnv> =>
  Effect.gen(function*() {
    if (!yes) {
      yield* Console.log(`Re-run with --yes to upgrade cluster "${config.name}" (strategy: ${strategy}).`)
      return
    }
    const { clients } = yield* UpcloudEnv
    const info = yield* findClusterByName({ clients, name: config.name })
    if (info === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "kube", ref: config.name }))
    yield* upgradeCluster({
      clients,
      uuid: info.uuid,
      currentVersion: config.version,
      strategy,
      upgradeStrategy: config.upgrade_strategy ?? "manual"
    })
    yield* Console.log(`Upgrade requested for cluster "${config.name}" (strategy: ${strategy}).`)
  })
