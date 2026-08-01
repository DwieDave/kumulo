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
  // networking fields are create-time only, immutable after
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
