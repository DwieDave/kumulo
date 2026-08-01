import { CloudProvider, computePlan, resourceName } from "@kumulo/core"
import type { CloudError, DesiredResource, Inventory, Plan, ServerSpec, TaggedResource } from "@kumulo/core"
import type { K3sClusterConfig } from "../cluster-config.ts"
import { Effect } from "effect"
import { dnsPlanActions } from "../dns-plan.ts"

const MASTER_POOL = "masters"

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

const _workerNodes = (config: K3sClusterConfig): ReadonlyArray<DesiredNode> =>
  config.worker_pools.flatMap((pool) =>
    Array.from({ length: pool.count }, (_, i) => _node({ config, role: "worker", pool: pool.name, flavor: pool.flavor, index: i + 1 }))
  )

export const buildK3sNodes = (config: K3sClusterConfig): ReadonlyArray<DesiredNode> => [
  ..._masterNodes(config),
  ..._workerNodes(config)
]

export const buildK3sServerSpecs = (config: K3sClusterConfig): ReadonlyArray<ServerSpec> =>
  buildK3sNodes(config).map((node) => node.spec)

export interface K3sInfraObserved {
  readonly network: boolean
  readonly securityGroups: boolean
  readonly loadBalancer: boolean
}

export const k3sNetworkRow = (cluster: string): string => `network/${cluster}`
export const k3sSecurityGroupRow = (cluster: string): string => `security-group/${cluster}`
export const k3sLbRow = (cluster: string): string => `load-balancer/${cluster}`

const _infraActions = (
  { config, infra }: { readonly config: K3sClusterConfig; readonly infra: K3sInfraObserved }
): Plan["actions"] =>
  ([
    [k3sNetworkRow(config.name), infra.network],
    [k3sSecurityGroupRow(config.name), infra.securityGroups],
    [k3sLbRow(config.name), infra.loadBalancer]
  ] as const).map(([name, exists]) => exists ? { _tag: "NoOp" as const, name } : { _tag: "Create" as const, name })

const NO_INFRA: K3sInfraObserved = { network: false, securityGroups: false, loadBalancer: false }

export const k3sPlanFor = (
  { config, observed, infra = NO_INFRA }: {
    readonly config: K3sClusterConfig
    readonly observed: ReadonlyArray<TaggedResource>
    readonly infra?: K3sInfraObserved
  }
): Plan => ({
  actions: [
    ..._infraActions({ config, infra }),
    ...computePlan({ desired: buildK3sNodes(config), actual: observed }).actions,
    ...dnsPlanActions({ config: config.dns, targets: { api_server: "ip" } })
  ]
})

export const buildK3sPlan = (config: K3sClusterConfig): Plan => k3sPlanFor({ config, observed: [] })

const _observedInfra = (inventory: Inventory): K3sInfraObserved => ({
  network: inventory.networks.length > 0,
  securityGroups: inventory.securityGroups.length > 0,
  loadBalancer: inventory.loadBalancers.length > 0
})

export const k3sPlanEffect = (
  config: K3sClusterConfig
): Effect.Effect<Plan, CloudError, CloudProvider> =>
  Effect.gen(function*() {
    const cloudProvider = yield* CloudProvider
    const inventory = yield* cloudProvider.listClusterResources(config.name)
    return k3sPlanFor({
      config,
      observed: inventory.servers.map((server) => ({ name: server.name, configHash: server.configHash })),
      infra: _observedInfra(inventory)
    })
  })

export const k3sDeletePlanActions = (
  config: K3sClusterConfig
): Effect.Effect<Plan["actions"], CloudError, CloudProvider> =>
  Effect.gen(function*() {
    const cloudProvider = yield* CloudProvider
    const inventory = yield* cloudProvider.listClusterResources(config.name)
    const liveNames = new Set(inventory.servers.map((server) => server.name))
    const desiredNames = buildK3sNodes(config).map((node) => node.spec.name)
    const nodeActions: Plan["actions"] = [
      ...inventory.servers.map((server) => ({ _tag: "Delete" as const, name: server.name })),
      ...desiredNames.filter((name) => !liveNames.has(name)).map((name) => ({
        _tag: "NoOp" as const,
        name: `${name} (already absent)`
      }))
    ]
    const infra = _observedInfra(inventory)
    const infraActions: Plan["actions"] = ([
      [k3sNetworkRow(config.name), infra.network],
      [k3sSecurityGroupRow(config.name), infra.securityGroups],
      [k3sLbRow(config.name), infra.loadBalancer]
    ] as const).map(([name, exists]) =>
      exists ? { _tag: "Delete" as const, name } : { _tag: "NoOp" as const, name: `${name} (already absent)` }
    )
    return [...nodeActions, ...infraActions]
  })
