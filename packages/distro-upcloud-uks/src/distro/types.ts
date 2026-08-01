import type { NetworkClient, NodeGroupsClient, RouterClient, UksClient } from "@kumulo/upcloud"

export interface UksLabel {
  readonly key: string
  readonly value: string
}

export interface UksWorkerPoolConfig {
  readonly name: string
  readonly plan: string
  readonly count: number
  readonly labels?: ReadonlyArray<UksLabel> | undefined
  readonly taints?: ReadonlyArray<string> | undefined
  readonly ssh_keys?: ReadonlyArray<string> | undefined
  readonly storage?: string | undefined
  readonly anti_affinity?: boolean | undefined
  readonly utility_network_access?: boolean | undefined
}

export interface UksClusterConfig {
  readonly name: string
  readonly zone: string
  readonly version: string
  readonly plan?: string | undefined
  readonly network: { readonly cidr: string }
  readonly worker_pools: ReadonlyArray<UksWorkerPoolConfig>
  readonly control_plane_ip_filter?: ReadonlyArray<string> | undefined
  readonly storage_encryption?: boolean | undefined
  readonly upgrade_strategy?: UksUpgradeStrategy | undefined
}

export interface UksClusterRef {
  readonly uuid: string
  readonly name: string
}

export type UksUpgradeStrategy = "LATEST_PATCH" | "NEXT_MINOR"

export interface UksClients {
  readonly uks: UksClient
  readonly nodeGroups: NodeGroupsClient
  readonly network: NetworkClient
  readonly router: RouterClient
}
