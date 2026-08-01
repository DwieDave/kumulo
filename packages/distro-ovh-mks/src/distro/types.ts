/**
 * Local input/ref shapes for the `ovh-mks` managed distro.
 *
 * kumulo: `@kumulo/core`'s `ClusterConfigShape`/`WorkerPoolShape` (domain
 * types) are deliberately minimal — just enough for cross-distro validation
 * rules. They don't carry the OVH MKS-specific pool fields
 * (flavor/min/max/desired/antiAffinity/monthlyBilled) this distro actually
 * needs to talk to the API. Rather than widen core's shared shape from this
 * package (out of scope/ownership) or reach into it with unsafe casts, this
 * distro declares its own richer input shape, field-for-field aligned with
 * the real config schema's naming. Any decoded `ClusterConfig` is a
 * structural superset and satisfies it with no adapter; wiring it in as the
 * literal `ManagedDistroShape` from `@kumulo/core` is the composition root's
 * job.
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

export interface MksDriverConfig {
  readonly serviceName: string
  readonly name: string
  readonly region: string
  readonly version?: Cloud_kube_VersionEnum
  // Creation-time only: `Cloud_ProjectKubeUpdate` is `{ name?, updatePolicy? }`,
  // so a cluster's networking is fixed the moment it exists. All three are
  // resolved from a `NetworkInfo` before `ensureCluster` runs (R7), or none are.
  readonly privateNetworkId?: string
  readonly nodesSubnetId?: string
  readonly loadBalancersSubnetId?: string
  readonly worker_pools: ReadonlyArray<MksWorkerPoolConfig>
}

export interface MksClusterRef {
  readonly serviceName: string
  readonly kubeId: string
}

export type MksUpgradeStrategy = "LATEST_PATCH" | "NEXT_MINOR"
