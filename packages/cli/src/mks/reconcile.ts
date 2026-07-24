import { Effect } from "effect"
import { ResourceNotFound } from "@kumulo/core"
import type { ClusterConfig, Kubeconfig, ManagedClusterInfo, MksError } from "@kumulo/core"
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

/** Converge control plane + nodepools onto the config (create and scale share this). */
export const applyMks = (
  config: ClusterConfig
): Effect.Effect<ManagedClusterInfo, MksError, MksEnv> =>
  Effect.gen(function*() {
    const { mks, serviceName } = yield* MksEnv
    const version = yield* parseKubeVersion(config.version)
    const mksConfig: MksClusterConfig = { ..._toMksConfig({ config, serviceName }), version }
    const info = yield* ensureCluster({ mks, config: mksConfig })
    const ref: MksClusterRef = { serviceName, kubeId: info.id }
    yield* ensureNodePools({ mks, ref, pools: mksConfig.worker_pools })
    return info
  })

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
export const deleteMks = (config: ClusterConfig): Effect.Effect<void, MksError, MksEnv> =>
  Effect.gen(function*() {
    const { mks, serviceName } = yield* MksEnv
    const mksConfig = _toMksConfig({ config, serviceName })
    const info = yield* findClusterByName({ mks, config: mksConfig })
    if (info === undefined) return
    yield* deleteCluster({ mks, ref: { serviceName, kubeId: info.id } })
  })
