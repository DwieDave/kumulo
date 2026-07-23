import { Effect } from "effect"
import type { ClusterConfig, Kubeconfig, ManagedClusterInfo, MksError } from "@kumulo/core"
import {
  deleteCluster,
  ensureCluster,
  ensureNodePools,
  fetchKubeconfig,
  type MksClusterConfig,
  type MksClusterRef,
  type MksWorkerPoolConfig
} from "@kumulo/distro-ovh-mks"
import { MksEnv } from "./env.ts"

// ponytail: `MksClusterConfig.version` is generated-client-only enum
// (`Cloud_kube_VersionEnum`, not re-exported through distro-ovh-mks's
// package root — reaching into its `generated/` internals would violate
// the no-deep-package-imports lint rule). Left unset here — OVH defaults
// new clusters to its current stable version; wire a real mapping once
// the distro package exports the enum (or a validator) at its root.
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

/** FR-6.1 — converge control plane + nodepools onto the config (create and scale share this). */
export const applyMks = (
  config: ClusterConfig
): Effect.Effect<ManagedClusterInfo, MksError, MksEnv> =>
  Effect.gen(function*() {
    const { mks, serviceName } = yield* MksEnv
    const mksConfig = _toMksConfig({ config, serviceName })
    const info = yield* ensureCluster({ mks, config: mksConfig })
    const ref: MksClusterRef = { serviceName, kubeId: info.id }
    yield* ensureNodePools({ mks, ref, pools: mksConfig.worker_pools })
    return info
  })

/** FR-6.2 — kubeconfig via the OVH API; resolves the cluster by name first (stateless, FR-2.1). */
export const kubeconfigMks = (
  config: ClusterConfig
): Effect.Effect<Kubeconfig, MksError, MksEnv> =>
  Effect.gen(function*() {
    const { mks, serviceName } = yield* MksEnv
    const info = yield* ensureCluster({ mks, config: _toMksConfig({ config, serviceName }) })
    return yield* fetchKubeconfig({ mks, ref: { serviceName, kubeId: info.id } })
  })

/** FR-2.6 — delete: resolves the cluster by name (idempotent lookup), then tears it down. */
export const deleteMks = (config: ClusterConfig): Effect.Effect<void, MksError, MksEnv> =>
  Effect.gen(function*() {
    const { mks, serviceName } = yield* MksEnv
    const info = yield* ensureCluster({ mks, config: _toMksConfig({ config, serviceName }) })
    yield* deleteCluster({ mks, ref: { serviceName, kubeId: info.id } })
  })
