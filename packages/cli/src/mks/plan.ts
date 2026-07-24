import type { Plan, PlanAction } from "@kumulo/core"

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

/** Live existence, as looked up right before planning (see `lookupMksInventory`). */
export interface MksInventory {
  readonly clusterExists: boolean
  readonly poolNames: ReadonlySet<string>
  readonly volumeNames: ReadonlySet<string>
}

export const emptyMksInventory: MksInventory = {
  clusterExists: false,
  poolNames: new Set(),
  volumeNames: new Set()
}

const _createOrNoOp = (exists: boolean, name: string): PlanAction =>
  exists ? { _tag: "NoOp", name } : { _tag: "Create", name }

// Existence-only diff: spec drift (flavor, autoscaling, size) still converges
// via the idempotent ensure* verbs without showing as Replace here — those
// fields aren't exposed by the lookups yet.
export const buildMksPlan = (config: MksPlanInput, inventory: MksInventory): Plan => ({
  actions: [
    _createOrNoOp(inventory.clusterExists, `mks-cluster/${config.name}`),
    ...config.worker_pools.map((pool) =>
      _createOrNoOp(inventory.clusterExists && inventory.poolNames.has(pool.name), `mks-pool/${config.name}/${pool.name}`)
    ),
    ...(config.volumes.module === "cinder"
      ? config.volumes.managed.map((v) => _createOrNoOp(inventory.volumeNames.has(v.name), `volume/${v.name}`))
      : [])
  ]
})
