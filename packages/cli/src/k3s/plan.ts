import { resourceName } from "@kumulo/core"
import type { ClusterConfig, Plan, ServerSpec } from "@kumulo/core"
import { dnsPlanActions } from "../dns-plan.ts"

const MASTER_POOL = "masters"

/** One `ServerSpec` per master, per-index named. */
const _masterSpecs = (config: ClusterConfig): ReadonlyArray<ServerSpec> =>
  Array.from({ length: config.masters.count }, (_, i) => ({
    name: resourceName({ cluster: config.name, role: "master", pool: MASTER_POOL, index: i + 1 }),
    role: "master",
    flavor: config.masters.flavor,
    image: config.masters.image,
    tag: config.name
  }))

// kumulo: WHY worker pools carry no `image` field — every pool shares the
// masters' image (one image per cluster, not per pool).
const _workerSpecs = (config: ClusterConfig): ReadonlyArray<ServerSpec> =>
  config.worker_pools.flatMap((pool) =>
    Array.from({ length: pool.count }, (_, i) => ({
      name: resourceName({ cluster: config.name, role: "worker", pool: pool.name, index: i + 1 }),
      role: "worker" as const,
      flavor: pool.flavor,
      image: config.masters.image,
      tag: config.name
    }))
  )

/** Every desired node for the "Nodes" phase, masters first (bootstrap order needs them created first). */
export const buildK3sServerSpecs = (config: ClusterConfig): ReadonlyArray<ServerSpec> => [
  ..._masterSpecs(config),
  ..._workerSpecs(config)
]

// ponytail: same simplification as `mks/plan.ts` — a real Create/NoOp/Delete
// diff needs the CloudProvider's tagged inventory mapped back into `plan`'s
// `TaggedResource` shape (config-hash per resource), which the port doesn't
// carry yet. `ensureServer`/`ensureNetwork`/etc are genuinely idempotent, so
// this only affects what the plan *prints*. Upgrade alongside mks/plan.ts.
export const buildK3sPlan = (config: ClusterConfig): Plan => ({
  actions: [
    ...buildK3sServerSpecs(config).map((spec) => ({ _tag: "Create" as const, name: spec.name })),
    // k3s points `api_server` at a master IP → A record (see `applyK3s`).
    ...dnsPlanActions({ config: config.dns, targetKind: "ip" })
  ]
})
