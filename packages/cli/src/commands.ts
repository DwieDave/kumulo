import { dirname } from "node:path"
import { Console, Effect } from "effect"
import { Command } from "effect/unstable/cli"
import type { ClusterConfig } from "@kumulo/core"
import { loadConfig } from "./config.ts"
import { reconcileVolumesOnDelete, volumes } from "./commands/volumes.ts"
import { status } from "./commands/status.ts"
import { upgrade } from "./commands/upgrade.ts"
import { buildK3sPlan } from "./k3s/plan.ts"
import { applyK3s, deleteK3s, kubeconfigK3s } from "./k3s/reconcile.ts"
import { buildMksPlan } from "./mks/plan.ts"
import { applyMks, deleteMks, kubeconfigMks } from "./mks/reconcile.ts"
import { decidePlanAction, renderPlan } from "./present.ts"
import { kumulo } from "./root.ts"

export { kumulo }

// The one distro-kind branch point; every command below dispatches on it
// the same way `upgrade.ts` already does.
const _isK3s = (config: ClusterConfig): boolean => config.distro === "k3s"

/** Config → plan → present → apply, shared by `create` and `scale`. */
const _applyFlow = Effect.fn(function*() {
  const root = yield* kumulo
  const config = yield* loadConfig(root.config)
  const plan = _isK3s(config) ? buildK3sPlan(config) : buildMksPlan(config)
  const decision = decidePlanAction({ plan, yes: root.yes, dryRun: root.dryRun })
  yield* Console.log(renderPlan(plan))

  if (decision._tag === "DryRun" || decision._tag === "NothingToDo") return
  if (decision._tag === "NeedsConfirm") {
    yield* Console.log("\nRe-run with --yes to apply.")
    return
  }

  if (_isK3s(config)) {
    const result = yield* applyK3s({ config, configDir: dirname(root.config) })
    yield* Console.log(`\nCluster "${config.name}" is up (${result.apiEndpoint}); kubeconfig at ${result.kubeconfigPath}.`)
    return
  }
  const info = yield* applyMks(config)
  yield* Console.log(`\nCluster "${config.name}" is ${info.status} (${info.apiEndpoint}).`)
})

export const create = Command.make("create", {}, _applyFlow).pipe(
  Command.withDescription("Create or converge a cluster onto its config")
)

export const scale = Command.make("scale", {}, _applyFlow).pipe(
  Command.withDescription("Converge worker pool sizes onto the config (same reconcile as create)")
)

export const kubeconfig = Command.make(
  "kubeconfig",
  {},
  Effect.fn(function*() {
    const root = yield* kumulo
    const config = yield* loadConfig(root.config)
    const result = _isK3s(config) ? yield* kubeconfigK3s(config) : yield* kubeconfigMks(config)
    yield* Console.log(result.content)
  })
).pipe(Command.withDescription("Print the cluster's kubeconfig"))

export const del = Command.make(
  "delete",
  {},
  Effect.fn(function*() {
    const root = yield* kumulo
    const config = yield* loadConfig(root.config)

    if (!root.yes) {
      yield* Console.log(`Re-run with --yes to delete cluster "${config.name}".`)
      return
    }
    if (_isK3s(config)) yield* deleteK3s(config)
    else yield* deleteMks(config)
    yield* Console.log(`Cluster "${config.name}" deleted.`)

    // Retained volumes (`volumes.retained[].retain: true`) survive `delete`;
    // anything else recorded there is torn down alongside the cluster.
    const kept = yield* reconcileVolumesOnDelete(config)
    if (kept.length > 0) yield* Console.log(`Retained volumes (kept): ${kept.join(", ")}`)
  })
).pipe(Command.withDescription("Delete a cluster"))

export const kumuloCli = kumulo.pipe(
  Command.withSubcommands([create, scale, status, kubeconfig, del, upgrade, volumes])
)
