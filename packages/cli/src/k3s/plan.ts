import { CloudProvider, computePlan, resourceName } from "@kumulo/core"
import type { CloudError, DesiredResource, Plan, ServerSpec, TaggedResource } from "@kumulo/core"
import type { K3sClusterConfig } from "../cluster-config.ts"
import { Effect } from "effect"
import { dnsPlanActions } from "../dns-plan.ts"

const MASTER_POOL = "masters"

/** Coordinates + the `ServerSpec` they name: one row per desired node. */
type DesiredNode = DesiredResource & { readonly spec: ServerSpec }

const _node = (
  { config, index, pool, flavor, role }: {
    readonly config: K3sClusterConfig
    readonly role: ServerSpec["role"]
    readonly pool: string
    readonly flavor: string
    readonly index: number
  }
): DesiredNode => ({
  cluster: config.name,
  role,
  pool,
  index,
  spec: {
    name: resourceName({ cluster: config.name, role, pool, index }),
    role,
    flavor,
    image: config.masters.image,
    tag: config.name
  }
})

const _masterNodes = (config: K3sClusterConfig): ReadonlyArray<DesiredNode> =>
  Array.from({ length: config.masters.count }, (_, i) =>
    _node({ config, role: "master", pool: MASTER_POOL, flavor: config.masters.flavor, index: i + 1 }))

// kumulo: WHY worker pools carry no `image` field — every pool shares the
// masters' image (one image per cluster, not per pool).
const _workerNodes = (config: K3sClusterConfig): ReadonlyArray<DesiredNode> =>
  config.worker_pools.flatMap((pool) =>
    Array.from({ length: pool.count }, (_, i) => _node({ config, role: "worker", pool: pool.name, flavor: pool.flavor, index: i + 1 }))
  )

/** Every desired node, masters first (bootstrap order needs them created first). */
export const buildK3sNodes = (config: K3sClusterConfig): ReadonlyArray<DesiredNode> => [
  ..._masterNodes(config),
  ..._workerNodes(config)
]

export const buildK3sServerSpecs = (config: K3sClusterConfig): ReadonlyArray<ServerSpec> =>
  buildK3sNodes(config).map((node) => node.spec)

/**
 * Real Create/NoOp/Delete rows: `observed` is the cluster's current inventory
 * (empty = nothing provisioned yet). Drift becomes `ReplaceNeedsConfirm` only
 * for observed resources that carry a `configHash` (stamped by the provider on
 * create); a server created before stamping carries none and plans as `NoOp`.
 */
export const k3sPlanFor = (
  { config, observed }: {
    readonly config: K3sClusterConfig
    readonly observed: ReadonlyArray<TaggedResource>
  }
): Plan => ({
  actions: [
    ...computePlan({ desired: buildK3sNodes(config), actual: observed }).actions,
    // k3s points `api_server` at a master IP -> A record (see `applyK3s`), and
    // resolves no other placeholder (scope §5).
    ...dnsPlanActions({ config: config.dns, targets: { api_server: "ip" } })
  ]
})

/** Plan with no observed state: every node is a Create. Prefer `k3sPlanEffect`. */
export const buildK3sPlan = (config: K3sClusterConfig): Plan => k3sPlanFor({ config, observed: [] })

/** `k3sPlanFor` against the live inventory - an absent cluster observes nothing. */
export const k3sPlanEffect = (
  config: K3sClusterConfig
): Effect.Effect<Plan, CloudError, CloudProvider> =>
  Effect.gen(function*() {
    const cloudProvider = yield* CloudProvider
    const inventory = yield* cloudProvider.listClusterResources(config.name)
    return k3sPlanFor({
      config,
      observed: inventory.servers.map((server) => ({ name: server.name, configHash: server.configHash }))
    })
  })
