import { Console, Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { findClusterByName } from "@kumulo/distro-ovh-mks"
import { loadConfig } from "../config.ts"
import { DistroNotWired } from "../distro-not-wired.ts"
import { MksEnv } from "../mks/env.ts"
import { kumulo } from "../root.ts"

/**
 * FR-10 — `status`: inventory + cluster health. Only `ovh-mks` is wired
 * live here (same scope limit `create`/`scale`/`kubeconfig`/`delete` all
 * share, see `distro-not-wired.ts`) — a k3s status additionally needs a
 * `K8sClient` composition root (kubeconfig → authenticated HTTP client),
 * which no command builds yet (T8.3's memory notes the identical gap for
 * `kubeconfig`/`upgrade`). Revisit once that composition root lands.
 */
export const status = Command.make(
  "status",
  {},
  Effect.fn(function*() {
    const root = yield* kumulo
    const config = yield* loadConfig(root.config)
    if (config.distro !== "ovh-mks") {
      return yield* Effect.fail(new DistroNotWired({ distro: config.distro }))
    }
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
).pipe(Command.withDescription("Show cluster inventory + health (FR-10)"))
