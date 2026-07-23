import { Console, Effect } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { loadConfig } from "./config.ts"
import { DistroNotWired } from "./distro-not-wired.ts"
import { buildMksPlan } from "./mks/plan.ts"
import { applyMks, deleteMks, kubeconfigMks } from "./mks/reconcile.ts"
import { decidePlanAction, renderPlan } from "./present.ts"

const configFlag = Flag.string("config").pipe(
  Flag.withAlias("c"),
  Flag.withDescription("Path to the cluster YAML config")
)
const yesFlag = Flag.boolean("yes").pipe(
  Flag.withAlias("y"),
  Flag.withDescription("Skip the confirmation prompt")
)
const dryRunFlag = Flag.boolean("dry-run").pipe(
  Flag.withDescription("Print the plan without applying it")
)

/** FR-10.1 — root command; `--config`/`--yes`/`--dry-run` are shared by every subcommand. */
export const kumulo = Command.make("kumulo").pipe(
  Command.withSharedFlags({ config: configFlag, yes: yesFlag, dryRun: dryRunFlag }),
  Command.withDescription("Provision and manage kumulo-managed Kubernetes clusters")
)

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
  })
).pipe(Command.withDescription("Delete a cluster (FR-2.6)"))

export const kumuloCli = kumulo.pipe(Command.withSubcommands([create, scale, kubeconfig, del]))
