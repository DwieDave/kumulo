import { Console, Effect } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { ResourceNotFound } from "@kumulo/core"
import type { ClusterConfig } from "@kumulo/core"
import { findClusterByName, upgrade as upgradeMks } from "@kumulo/distro-ovh-mks"
import { renderUpgradePlan } from "@kumulo/distro-k3s"
import { loadConfig } from "../config.ts"
import { MksEnv } from "../mks/env.ts"
import { kumulo } from "../root.ts"

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

// FR-6.2 — OVH drives the upgrade itself via its API; there's no local plan
// to render, just a lookup (by name, same as every other mks command) + the
// update call.
const _upgradeMks = (
  { config, strategy, yes }: { readonly config: ClusterConfig; readonly strategy: "LATEST_PATCH" | "NEXT_MINOR"; readonly yes: boolean }
) =>
  Effect.gen(function*() {
    if (!yes) {
      yield* Console.log(`Re-run with --yes to upgrade cluster "${config.name}" (strategy: ${strategy}).`)
      return
    }
    const { mks, serviceName } = yield* MksEnv
    const info = yield* findClusterByName({ mks, config: { serviceName, name: config.name, region: config.auth.region, worker_pools: [] } })
    if (info === undefined) return yield* Effect.fail(new ResourceNotFound({ kind: "kube", ref: config.name }))
    yield* upgradeMks({ mks, ref: { serviceName, kubeId: info.id }, strategy })
    yield* Console.log(`Upgrade requested for cluster "${config.name}" (strategy: ${strategy}).`)
  })

// FR-5.6 — k3s upgrades are SUC-driven: this command only renders the Plan
// CRs (design §7 "SUC plan for new k3s version"); applying them is a
// `kubectl apply` (or a future CLI apply flag once T8.3's sibling k3s CLI
// wiring lands — no k3s command path exists yet, see `distro-not-wired.ts`).
const _renderK3s = (
  { config, workerConcurrency }: { readonly config: ClusterConfig; readonly workerConcurrency: number }
) =>
  Effect.gen(function*() {
    const plan = renderUpgradePlan({ version: config.version, workerConcurrency })
    yield* Console.log(plan.map((manifest) => JSON.stringify(manifest, null, 2)).join("\n---\n"))
    yield* Console.log(`\nApply with: kubectl apply -f - <<'EOF' (paste the above) EOF`)
  })

export const upgrade = Command.make(
  "upgrade",
  { strategy: strategyFlag, workerConcurrency: workerConcurrencyFlag },
  Effect.fn(function*({ strategy, workerConcurrency }) {
    const root = yield* kumulo
    const config = yield* loadConfig(root.config)
    if (config.distro === "ovh-mks") return yield* _upgradeMks({ config, strategy, yes: root.yes })
    yield* _renderK3s({ config, workerConcurrency })
  })
).pipe(Command.withDescription("Upgrade the cluster: renders SUC Plans for k3s, drives the OVH API for ovh-mks (FR-5.6, FR-6.2)"))
