import { Effect } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { loadConfig } from "../config.ts"
import { onDistro } from "../distro/registry.ts"
import { configArgument, kumulo } from "../root.ts"

export { applyK3sUpgradeWith } from "../distro/k3s-entry.ts"

const strategyFlag = Flag.choiceWithValue("strategy", [
  ["latest-patch", "LATEST_PATCH" as const],
  ["next-minor", "NEXT_MINOR" as const]
]).pipe(
  Flag.withDefault("LATEST_PATCH" as const),
  Flag.withDescription("ovh-mks only: upgrade to the latest patch of the current minor, or the next minor")
)
const workerConcurrencyFlag = Flag.integer("worker-concurrency").pipe(
  Flag.withDefault(1),
  Flag.withDescription("k3s only: how many worker nodes the SUC agent Plan upgrades at once")
)

export const upgrade = Command.make(
  "upgrade",
  { config: configArgument(), strategy: strategyFlag, workerConcurrency: workerConcurrencyFlag },
  Effect.fn(function*({ config: configPath, strategy, workerConcurrency }) {
    const root = yield* kumulo
    const config = yield* loadConfig(configPath)
    yield* onDistro(config)(({ config: cfg, entry }) => entry.upgrade({ config: cfg, strategy, workerConcurrency, yes: root.yes, dryRun: root.dryRun }))
  })
).pipe(Command.withDescription("Upgrade the cluster: applies SUC Plans for k3s, drives the OVH API for ovh-mks"))
