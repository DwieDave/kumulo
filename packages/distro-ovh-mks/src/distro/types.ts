/**
 * Local input/ref shapes for the `ovh-mks` managed distro (design §3.3.1,
 * FR-6.1–6.2).
 *
 * kumulo: `@kumulo/core`'s `ClusterConfigShape`/`WorkerPoolShape` (domain
 * types) are deliberately minimal — just enough for cross-distro validation
 * rules (T6.2). They don't carry the OVH MKS-specific pool fields
 * (flavor/min/max/desired/antiAffinity/monthlyBilled) this distro actually
 * needs to talk to the API. Rather than widen core's shared shape from this
 * package (out of scope/ownership) or reach into it with unsafe casts, this
 * distro declares its own richer input shape, field-for-field aligned with
 * the real config schema's naming. Any decoded `ClusterConfig` is a
 * structural superset and satisfies it with no adapter; wiring it in as the
 * literal `ManagedDistroShape` from `@kumulo/core` is the composition root's
 * job (T4.2).
 */
import type { Cloud_kube_VersionEnum } from "../generated/client.ts"

export interface MksWorkerPoolConfig {
  readonly name: string
  readonly flavor: string
  readonly desiredNodes: number
  readonly minNodes: number
  readonly maxNodes: number
  readonly autoscale: boolean
  readonly antiAffinity: boolean
  readonly monthlyBilled: boolean
}

export interface MksClusterConfig {
  readonly serviceName: string
  readonly name: string
  readonly region: string
  readonly version?: Cloud_kube_VersionEnum
  readonly privateNetworkId?: string
  readonly nodesSubnetId?: string
  readonly worker_pools: ReadonlyArray<MksWorkerPoolConfig>
}

export interface MksClusterRef {
  readonly serviceName: string
  readonly kubeId: string
}

export type MksUpgradeStrategy = "LATEST_PATCH" | "NEXT_MINOR"
