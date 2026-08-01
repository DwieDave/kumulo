import type { NetworkInfo, Plan, PlanAction } from "@kumulo/core"
import { clusterDrift, mksPoolHash, type MksClusterState, type MksWorkerPoolConfig } from "@kumulo/distro-ovh-mks"
import { type DnsPlanInput, dnsPlanActions, type DnsPlanTargets } from "../dns-plan.ts"

export interface MksPoolInput {
  readonly name: string
  readonly flavor: string
  readonly count: number
  readonly autoscaling?: { readonly enabled: boolean; readonly min: number; readonly max: number }
}

export interface MksPlanInput {
  readonly name: string
  readonly worker_pools: ReadonlyArray<MksPoolInput>
  readonly volumes:
    | { readonly module: "none" }
    | { readonly module: "cinder" | "hcloud"; readonly managed: ReadonlyArray<{ readonly name: string }> }
  readonly dns?: DnsPlanInput
  readonly version?: string
  readonly auth?: { readonly region: string }
  readonly network?: { readonly cidr: string }
  readonly ingress?: { readonly flavor_id?: string }
}

export const toMksPool = (pool: MksPoolInput): MksWorkerPoolConfig => ({
  name: pool.name,
  flavor: pool.flavor,
  desiredNodes: pool.count,
  minNodes: pool.autoscaling?.enabled ? pool.autoscaling.min : pool.count,
  maxNodes: pool.autoscaling?.enabled ? pool.autoscaling.max : pool.count,
  autoscale: pool.autoscaling?.enabled ?? false,
  antiAffinity: true,
  monthlyBilled: false
})

export const mksClusterRow = (cluster: string): string => `mks-cluster/${cluster}`
export const mksPoolRow = (
  { cluster, pool }: { readonly cluster: string; readonly pool: string }
): string => `mks-pool/${cluster}/${pool}`

export interface MksInventory {
  readonly clusterExists: boolean
  readonly poolNames: ReadonlySet<string>
  readonly volumeNames: ReadonlySet<string>
  readonly poolHashes?: ReadonlyMap<string, string | undefined>
  readonly clusterState?: MksClusterState
  readonly resolvedNetwork?: NetworkInfo
}

export const emptyMksInventory: MksInventory = {
  clusterExists: false,
  poolNames: new Set(),
  volumeNames: new Set()
}

const _createOrNoOp = ({ exists, name }: { readonly exists: boolean; readonly name: string }): PlanAction =>
  exists ? { _tag: "NoOp", name } : { _tag: "Create", name }

const _poolAction = (
  { cluster, inventory, pool }: {
    readonly cluster: string
    readonly inventory: MksInventory
    readonly pool: MksPoolInput
  }
): PlanAction => {
  const name = mksPoolRow({ cluster, pool: pool.name })
  const exists = inventory.clusterExists && inventory.poolNames.has(pool.name)
  if (!exists) return { _tag: "Create", name }
  const actual = inventory.poolHashes?.get(pool.name)
  return actual === undefined || actual === mksPoolHash(toMksPool(pool))
    ? { _tag: "NoOp", name }
    : { _tag: "ReplaceNeedsConfirm", name, reason: "config-hash drifted from desired spec" }
}

const _clusterAction = (
  { config, inventory }: { readonly config: MksPlanInput; readonly inventory: MksInventory }
): PlanAction => {
  const name = mksClusterRow(config.name)
  if (!inventory.clusterExists) return { _tag: "Create", name }
  if (config.auth === undefined || inventory.clusterState === undefined) return { _tag: "NoOp", name }
  const drift = clusterDrift({
    desired: {
      region: config.auth.region,
      version: config.version,
      privateNetwork: config.network !== undefined,
      nodesSubnetId: inventory.resolvedNetwork?.nodesSubnetId,
      loadBalancersSubnetId: inventory.resolvedNetwork?.loadBalancersSubnetId
    },
    actual: inventory.clusterState
  })
  if (drift._tag === "None") return { _tag: "NoOp", name }
  return drift._tag === "Upgrade"
    ? { _tag: "Update", name, reason: `kubernetes version ${drift.from} → ${drift.to}` }
    : { _tag: "ReplaceNeedsConfirm", name, reason: `${drift.field}: ${drift.reason}` }
}

// an orphaned network plans Create and no-ops on apply (ensureNetwork is create-if-missing); add a read-only Neutron lookup if that
// stops being rare.
const _networkActions = (
  { config, inventory }: { readonly config: MksPlanInput; readonly inventory: MksInventory }
): ReadonlyArray<PlanAction> => {
  if (config.network === undefined) return []
  const id = inventory.clusterState?.privateNetworkId
  const exists = id !== undefined && id !== null && id !== ""
  return [
    `network/${config.name}`,
    `subnet/${config.name}/nodes`,
    `subnet/${config.name}/load-balancers`,
    `gateway/${config.name}`
  ].map((name) => _createOrNoOp({ exists, name }))
}

// existence inferred from the cluster's; adding ingress to a live cluster plans NoOp then creates — same fix as _networkActions if it
// stops being rare.
const _ingressActions = (
  { config, inventory }: { readonly config: MksPlanInput; readonly inventory: MksInventory }
): ReadonlyArray<PlanAction> =>
  config.ingress === undefined ? [] : [
    `load-balancer/${config.name}/ingress`,
    `floating-ip/${config.name}/ingress`
  ].map((name) => _createOrNoOp({ exists: inventory.clusterExists, name }))

const _dnsTargets = (config: MksPlanInput): DnsPlanTargets => ({
  api_server: "hostname",
  ...(config.ingress === undefined ? {} : { ingress: "ip" as const })
})

export const buildMksPlan = (
  { config, inventory }: { readonly config: MksPlanInput; readonly inventory: MksInventory }
): Plan => ({
  actions: [
    ..._networkActions({ config, inventory }),
    _clusterAction({ config, inventory }),
    ...config.worker_pools.map((pool) => _poolAction({ cluster: config.name, inventory, pool })),
    ..._ingressActions({ config, inventory }),
    ...(config.volumes.module === "cinder"
      ? config.volumes.managed.map((v) => _createOrNoOp({ exists: inventory.volumeNames.has(v.name), name: `volume/${v.name}` }))
      : []),
    ...(config.dns === undefined ? [] : dnsPlanActions({ config: config.dns, targets: _dnsTargets(config) }))
  ]
})
