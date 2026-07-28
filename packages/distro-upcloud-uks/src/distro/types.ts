/**
 * Local input/ref shapes for the `upcloud-uks` managed distro.
 *
 * kumulo: `@kumulo/core`'s `ClusterConfigShape`/`WorkerPoolShape` (domain
 * types) are deliberately minimal — just enough for cross-distro validation
 * rules. They don't carry the UKS-specific node-group fields this distro
 * actually needs to talk to the API. Rather than widen core's shared shape
 * from this package (out of scope/ownership), this distro declares its own
 * richer input shape, field-for-field aligned with the real config schema's
 * naming. Any decoded `UpcloudUksClusterConfig` is a structural superset and
 * satisfies it with no adapter.
 */
import type { NetworkClient, NodeGroupsClient, RouterClient, UksClient } from "@kumulo/upcloud"

/** One `{key, value}` label pair, UpCloud's shape (D14). */
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

/**
 * The four UpCloud API surfaces the driver talks to, bundled the way
 * `distro-ovh-mks` bundles its single `Mks` generated client — one argument
 * threaded through every `ensure*`/`delete*` call instead of four (M5).
 */
export interface UksClients {
  readonly uks: UksClient
  readonly nodeGroups: NodeGroupsClient
  readonly network: NetworkClient
  readonly router: RouterClient
}
