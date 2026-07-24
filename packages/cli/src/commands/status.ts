import { Console, Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { findClusterByName } from "@kumulo/distro-ovh-mks"
import type { ClusterConfig } from "@kumulo/core"
import { loadConfig } from "../config.ts"
import { k3sStatus } from "../k3s/reconcile.ts"
import type { K3sStatus } from "../k3s/reconcile.ts"
import { MksEnv } from "../mks/env.ts"
import { kumulo } from "../root.ts"

const _statusK3s = Effect.fn(function*(config: ClusterConfig) {
  const info: K3sStatus = yield* k3sStatus(config)
  if (!info.exists) {
    yield* Console.log(`Cluster "${config.name}" does not exist.`)
    return
  }
  const nodes = info.nodes.length === 0
    ? "(none)"
    : info.nodes.map((n) => `${n.name} (${n.ready ? "Ready" : "NotReady"})`).join(", ")
  yield* Console.log(
    [`Cluster "${config.name}": running`, `  API endpoint: ${info.apiEndpoint}`, `  Nodes: ${nodes}`].join("\n")
  )
})

const _statusMks = Effect.fn(function*(config: ClusterConfig) {
  const { mks, serviceName } = yield* MksEnv
  const info = yield* findClusterByName({
    mks,
    config: { serviceName, name: config.name, region: config.auth.region, worker_pools: [] }
  })
  if (info === undefined) {
    yield* Console.log(`Cluster "${config.name}" does not exist.`)
    return
  }
  const pools = config.worker_pools.map((pool) => `${pool.name} (x${pool.count})`).join(", ") || "(none)"
  yield* Console.log(
    [`Cluster "${config.name}": ${info.status}`, `  API endpoint: ${info.apiEndpoint}`, `  Worker pools: ${pools}`]
      .join("\n")
  )
})

/** FR-10 — `status`: inventory + cluster health, for both distro kinds. */
export const status = Command.make(
  "status",
  {},
  Effect.fn(function*() {
    const root = yield* kumulo
    const config = yield* loadConfig(root.config)
    yield* config.distro === "k3s" ? _statusK3s(config) : _statusMks(config)
  })
).pipe(Command.withDescription("Show cluster inventory + health (FR-10)"))
