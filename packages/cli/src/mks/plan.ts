import type { Plan, PlanAction } from "@kumulo/core"
import { clusterDrift, mksPoolHash, type MksClusterState, type MksWorkerPoolConfig } from "@kumulo/distro-ovh-mks"
import { type DnsPlanInput, dnsPlanActions, type DnsPlanTargets } from "../dns-plan.ts"

/** Structural slice of a `ClusterConfig` worker pool — enough to build the MKS pool spec. */
export interface MksPoolInput {
  readonly name: string
  readonly flavor: string
  readonly count: number
  readonly autoscaling?: { readonly enabled: boolean; readonly min: number; readonly max: number }
}

// Structural slice of `ClusterConfig` (same pattern as core's
// `ClusterConfigShape`) — keeps this module's test fixtures minimal instead
// of requiring a full config object.
export interface MksPlanInput {
  readonly name: string
  readonly worker_pools: ReadonlyArray<MksPoolInput>
  readonly volumes:
    | { readonly module: "none" }
    | { readonly module: "cinder" | "hcloud"; readonly managed: ReadonlyArray<{ readonly name: string }> }
  // Optional so existing plan fixtures stay minimal; a real `ClusterConfig`
  // always carries it.
  readonly dns?: DnsPlanInput
  /** Cluster-level fields (same optionality rationale as `dns`). */
  readonly version?: string
  readonly auth?: { readonly region: string }
  /** The optional private-network block; absent is a config asking for none. */
  readonly network?: { readonly cidr: string }
  /** The optional ingress block; absent is a config asking for no load balancer. */
  readonly ingress?: { readonly flavor_id?: string }
}

/** The one place a config worker pool becomes an MKS nodepool spec — plan and apply must hash the same value. */
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

/** Plan row names — shared with the reconciler, which maps a confirmed row back to its pool. */
export const mksClusterRow = (cluster: string): string => `mks-cluster/${cluster}`
export const mksPoolRow = (
  { cluster, pool }: { readonly cluster: string; readonly pool: string }
): string => `mks-pool/${cluster}/${pool}`

/** Live existence, as looked up right before planning (see `lookupMksInventory`). */
export interface MksInventory {
  readonly clusterExists: boolean
  readonly poolNames: ReadonlySet<string>
  readonly volumeNames: ReadonlySet<string>
  /**
   * Pool name → the config hash stamped on it (`undefined` for a pool created
   * before stamping). `poolNames` stays the existence view its other readers
   * use; this adds the drift view.
   */
  readonly poolHashes?: ReadonlyMap<string, string | undefined>
  /** Cluster-scoped fields as read back from OVH; absent means "not looked up" → no drift claim. */
  readonly clusterState?: MksClusterState
}

export const emptyMksInventory: MksInventory = {
  clusterExists: false,
  poolNames: new Set(),
  volumeNames: new Set()
}

const _createOrNoOp = ({ exists, name }: { readonly exists: boolean; readonly name: string }): PlanAction =>
  exists ? { _tag: "NoOp", name } : { _tag: "Create", name }

/**
 * Same rule as core's `computePlan` (plan/diff.ts), applied to MKS node pools:
 * absent → Create, no stamped hash → NoOp (the pool exists, and we cannot
 * honestly tell it drifted), hash equal → NoOp, hash differs →
 * `ReplaceNeedsConfirm`. Only the immutable fields are hashed
 * (`mksPoolHash`), so scaling still converges as an in-place update.
 */
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

/**
 * The cluster row. Existence first (absent → `Create`), then cluster-level
 * drift (`clusterDrift`): a supported version bump is an in-place `Update`, an
 * immutable change is `ReplaceNeedsConfirm` — which the reconciler refuses
 * outright rather than destroying a live cluster (see `_poolsToReplace`), so
 * the operator sees the field named instead of a silent "converged".
 */
const _clusterAction = (
  { config, inventory }: { readonly config: MksPlanInput; readonly inventory: MksInventory }
): PlanAction => {
  const name = mksClusterRow(config.name)
  if (!inventory.clusterExists) return { _tag: "Create", name }
  if (config.auth === undefined || inventory.clusterState === undefined) return { _tag: "NoOp", name }
  const drift = clusterDrift({
    desired: { region: config.auth.region, version: config.version, privateNetwork: config.network !== undefined },
    actual: inventory.clusterState
  })
  if (drift._tag === "None") return { _tag: "NoOp", name }
  return drift._tag === "Upgrade"
    ? { _tag: "Update", name, reason: `kubernetes version ${drift.from} → ${drift.to}` }
    : { _tag: "ReplaceNeedsConfirm", name, reason: `${drift.field}: ${drift.reason}` }
}

/**
 * Network + subnet rows (R18). Existence comes off the live cluster: MKS
 * records the ids it was created with, and `ensureNetwork` creates both
 * subnets with the network, so one field answers for all three rows.
 *
 * ponytail: a network that outlived its cluster (an earlier apply that failed
 * after `ensureNetwork`) plans as `Create` and applies as a no-op, since
 * `ensureNetwork` is create-if-missing. Reading Neutron at plan time would
 * need a read-only network lookup the `CloudProvider` port does not have —
 * add one if that stops being the rare case.
 */
const _networkActions = (
  { config, inventory }: { readonly config: MksPlanInput; readonly inventory: MksInventory }
): ReadonlyArray<PlanAction> => {
  if (config.network === undefined) return []
  const id = inventory.clusterState?.privateNetworkId
  const exists = id !== undefined && id !== null && id !== ""
  return [`network/${config.name}`, `subnet/${config.name}/nodes`, `subnet/${config.name}/load-balancers`]
    .map((name) => _createOrNoOp({ exists, name }))
}

/**
 * Ingress LB + floating IP rows (R18). One LB, one floating IP (scope §4), so
 * these are two rows and not a list.
 *
 * ponytail: existence is inferred from the cluster's, because the ingress LB is
 * only ever created after `ensureCluster` — so no cluster means no LB. The
 * inversion (adding `ingress:` to a live cluster) plans NoOp and then creates,
 * the mirror image of `_networkActions`' ceiling and fixable the same way: a
 * read-only load-balancer lookup on the `CloudProvider` port. Reading Octavia
 * here today would also make `kumulo plan` fail without OS_* credentials, which
 * it does not need otherwise.
 */
const _ingressActions = (
  { config, inventory }: { readonly config: MksPlanInput; readonly inventory: MksInventory }
): ReadonlyArray<PlanAction> =>
  config.ingress === undefined ? [] : [
    `load-balancer/${config.name}/ingress`,
    `floating-ip/${config.name}/ingress`
  ].map((name) => _createOrNoOp({ exists: inventory.clusterExists, name }))

/**
 * What each DNS placeholder will resolve to at apply time (R16). The `ingress`
 * block is the whole signal: an ingress LB always gets a Neutron floating IP,
 * which is always IPv4 (scope §7), so the row is an A record even on the apply
 * that creates the LB — plan reads no Octavia address and needs none.
 *
 * No `ingress` block means the apply resolves `ingress` to nothing and writes
 * the placeholder literally (R15); `dnsPlanActions` then renders it exactly as
 * that write will land, instead of promising an address neither has.
 */
const _dnsTargets = (config: MksPlanInput): DnsPlanTargets => ({
  api_server: "hostname",
  ...(config.ingress === undefined ? {} : { ingress: "ip" as const })
})

export const buildMksPlan = (
  { config, inventory }: { readonly config: MksPlanInput; readonly inventory: MksInventory }
): Plan => ({
  actions: [
    // Ahead of the cluster row: the ids are creation-time inputs to it (R7).
    ..._networkActions({ config, inventory }),
    _clusterAction({ config, inventory }),
    ...config.worker_pools.map((pool) => _poolAction({ cluster: config.name, inventory, pool })),
    // After the cluster row: the LB is converged after `ensureCluster`.
    ..._ingressActions({ config, inventory }),
    ...(config.volumes.module === "cinder"
      ? config.volumes.managed.map((v) => _createOrNoOp({ exists: inventory.volumeNames.has(v.name), name: `volume/${v.name}` }))
      : []),
    // MKS exposes the api server as a hostname → CNAME (see `applyMks`).
    ...(config.dns === undefined ? [] : dnsPlanActions({ config: config.dns, targets: _dnsTargets(config) }))
  ]
})
