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
import { withRowProgress } from "../spinner.ts"
import { dnsProviderLayerFor, reconcileDns, removeDns } from "../dns.ts"
import type { DistroUpgradeArgs } from "../distro/types.ts"
import { convergeUpcloudBuckets, reconcileUpcloudObjectStorageOnDelete } from "./storage.ts"
import { convergeUpcloudVolumes, managedUpcloudVolumes, reconcileUpcloudVolumesOnDelete } from "./volumes.ts"

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
})

// safety: refuses outright when the control-plane row was confirmed for replace, since UpCloud owns it
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
    const network = yield* withRowProgress({
      match: (name) => name.startsWith("router/") || name.startsWith("network/"),
      effect: ensureNetwork({ clients, clusterName: config.name, zone: config.zone, cidr: config.network.cidr })
    })
    const info = yield* withRowProgress({
      match: (name) => name.startsWith("uks-cluster/"),
      effect: ensureCluster({ clients, config: _toUksConfig(config), networkUuid: network.networkUuid, owner: OWNER })
    })
    yield* withRowProgress({
      match: (name) => name.startsWith("uks-pool/"),
      effect: ensureNodePools({
        clients,
        ref: { uuid: info.uuid, name: info.name },
        pools: config.worker_pools.map(toUksPool),
        owner: OWNER,
        replace: pools
      })
    })
    const managedVolumes = managedUpcloudVolumes(config)
    if (config.dns.module !== "none" || managedVolumes.length > 0) {
      const kubeconfig = yield* fetchKubeconfig({ clients, uuid: info.uuid })
      if (config.dns.module !== "none") yield* reconcileUpcloudDns({ config, kubeconfig })
      if (managedVolumes.length > 0) {
        yield* withRowProgress({
          match: (name) => name.startsWith("volume/"),
          effect: convergeUpcloudVolumes({ config, kubeconfig })
        })
      }
    }
    yield* withRowProgress({
      match: (name) => name.startsWith("bucket/"),
      effect: convergeUpcloudBuckets(config)
    })
    return info
  })

export const applyUpcloudUks = (
  args: { readonly config: UpcloudUksClusterConfig; readonly replace: ReadonlySet<string> }
): Effect.Effect<
  UksClusterInfo,
  MksError | PlanRejected | ConfigInvalid | VolumeError | ObjectStorageError | CredentialsSinkError | PlatformError,
  UpcloudEnv | HttpClient.HttpClient | FileSystem | ChildProcessSpawnerNS.ChildProcessSpawner
> => applyUpcloudUksEffect(args).pipe(Effect.provide(dnsProviderLayerFor(args.config)))

// no endpoint field on the cluster response; hostname comes from kubeconfig's cluster.server URL
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

export const kubeconfigUpcloudUks = (
  config: UpcloudUksClusterConfig
): Effect.Effect<Kubeconfig, MksError, UpcloudEnv> =>
  Effect.gen(function*() {
    const { clients } = yield* UpcloudEnv
    const info = yield* findClusterByName({ clients, name: config.name })
    if (info === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "kube", ref: config.name }))
    return yield* fetchKubeconfig({ clients, uuid: info.uuid })
  })

// order: object-storage -> non-retained volumes -> cluster -> network -> router; retained resources are never deleted
const _deleteUpcloudUksEffect = (
  config: UpcloudUksClusterConfig
): Effect.Effect<void, MksError | ConfigInvalid | ObjectStorageError | VolumeError, UpcloudEnv | DnsProvider> =>
  Effect.gen(function*() {
    yield* withRowProgress({
      match: (name) => name.startsWith("bucket/"),
      effect: reconcileUpcloudObjectStorageOnDelete(config)
    })
    yield* withRowProgress({
      match: (name) => name.startsWith("volume/"),
      effect: reconcileUpcloudVolumesOnDelete(config)
    })
    const { clients } = yield* UpcloudEnv
    yield* withRowProgress({
      match: (name) => name.startsWith("uks-cluster/") || name.startsWith("uks-pool/"),
      effect: Effect.gen(function*() {
        const info = yield* findClusterByName({ clients, name: config.name })
        if (info !== undefined) {
          yield* deleteCluster({ clients, ref: { uuid: info.uuid, name: info.name } })
        }
      })
    })
    yield* withRowProgress({
      match: (name) => name.startsWith("network/") || name.startsWith("router/"),
      effect: deleteNetwork({ clients, clusterName: config.name })
    })
    yield* removeDns(config)
  })

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
