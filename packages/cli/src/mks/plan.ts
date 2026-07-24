import type { Plan } from "@kumulo/core"

// Structural slice of `ClusterConfig` (same pattern as core's
// `ClusterConfigShape`) — keeps this module's test fixtures minimal instead
// of requiring a full config object.
export interface MksPlanInput {
  readonly name: string
  readonly worker_pools: ReadonlyArray<{ readonly name: string }>
  readonly volumes: {
    readonly module: string
    readonly managed: ReadonlyArray<{ readonly name: string }>
  }
}

// ponytail: a real Create/NoOp/Delete diff needs a read-only cluster/nodepool
// (and Cinder volume) lookup by name, which distro-ovh-mks/volumes-cinder
// don't currently export (only the idempotent ensure* verbs). Every resource
// is presented as "Create" regardless of whether it already exists;
// `ensureCluster`/`ensureNodePools`/`ensureVolume` are the actual convergence
// and are genuinely idempotent, so this only affects what the plan *prints*,
// not what apply does. Upgrade to a real diff once a lookup is exported.
export const buildMksPlan = (config: MksPlanInput): Plan => ({
  actions: [
    { _tag: "Create", name: `mks-cluster/${config.name}` },
    ...config.worker_pools.map((pool) => ({ _tag: "Create" as const, name: `mks-pool/${config.name}/${pool.name}` })),
    ...(config.volumes.module === "cinder"
      ? config.volumes.managed.map((v) => ({ _tag: "Create" as const, name: `volume/${v.name}` }))
      : [])
  ]
})
