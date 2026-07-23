import { Console, Effect } from "effect"
import { Command } from "effect/unstable/cli"
import { loadConfig } from "./config.ts"
import { reconcileVolumesOnDelete, volumes } from "./commands/volumes.ts"
import { status } from "./commands/status.ts"
import { upgrade } from "./commands/upgrade.ts"
import { DistroNotWired } from "./distro-not-wired.ts"
import { buildMksPlan } from "./mks/plan.ts"
import { applyMks, deleteMks, kubeconfigMks } from "./mks/reconcile.ts"
import { decidePlanAction, renderPlan } from "./present.ts"
import { kumulo } from "./root.ts"

export { kumulo }

// FR-2.3 branches once on distro kind; only `ovh-mks` is wired live in this
// task (T4.2) — the self-managed (k3s) phase pipeline lands in M7.
const _requireMks = (config: { readonly distro: string }) =>
  config.distro === "ovh-mks" ? Effect.void : Effect.fail(new DistroNotWired({ distro: config.distro }))

/** Config → plan → present → apply (FR-2.2), shared by `create` and `scale`. */
const _applyFlow = Effect.fn(function*() {
  const root = yield* kumulo
  const config = yield* loadConfig(root.config)
  yield* _requireMks(config)

  const plan = buildMksPlan(config)
  const decision = decidePlanAction({ plan, yes: root.yes, dryRun: root.dryRun })
  yield* Console.log(renderPlan(plan))

  if (decision._tag === "DryRun" || decision._tag === "NothingToDo") return
  if (decision._tag === "NeedsConfirm") {
    yield* Console.log("\nRe-run with --yes to apply.")
    return
  }

  const info = yield* applyMks(config)
  yield* Console.log(`\nCluster "${config.name}" is ${info.status} (${info.apiEndpoint}).`)
})

export const create = Command.make("create", {}, _applyFlow).pipe(
  Command.withDescription("Create or converge a cluster onto its config")
)

export const scale = Command.make("scale", {}, _applyFlow).pipe(
  Command.withDescription("Converge worker pool sizes onto the config (same reconcile as create, FR-2.7)")
)

export const kubeconfig = Command.make(
  "kubeconfig",
  {},
  Effect.fn(function*() {
    const root = yield* kumulo
    const config = yield* loadConfig(root.config)
    yield* _requireMks(config)
    const result = yield* kubeconfigMks(config)
    yield* Console.log(result.content)
  })
).pipe(Command.withDescription("Print the cluster's kubeconfig"))

export const del = Command.make(
  "delete",
  {},
  Effect.fn(function*() {
    const root = yield* kumulo
    const config = yield* loadConfig(root.config)
    yield* _requireMks(config)

    if (!root.yes) {
      yield* Console.log(`Re-run with --yes to delete cluster "${config.name}".`)
      return
    }
    yield* deleteMks(config)
    yield* Console.log(`Cluster "${config.name}" deleted.`)

    // AC-7 — retained volumes (`volumes.retained[].retain: true`) survive
    // `delete`; anything else recorded there is torn down alongside the cluster.
    const kept = yield* reconcileVolumesOnDelete(config)
    if (kept.length > 0) yield* Console.log(`Retained volumes (kept): ${kept.join(", ")}`)
  })
).pipe(Command.withDescription("Delete a cluster (FR-2.6)"))

export const kumuloCli = kumulo.pipe(
  Command.withSubcommands([create, scale, status, kubeconfig, del, upgrade, volumes])
)
