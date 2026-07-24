import { dirname } from "node:path"
import { Console, Effect } from "effect"
import { Command } from "effect/unstable/cli"
import type { ClusterConfig, Plan } from "@kumulo/core"
import { ovhObjectStorageProviderLive } from "@kumulo/storage-ovh"
import { loadConfig } from "./config.ts"
import { convergeManagedVolumes, lookupManagedVolumeNames, reconcileVolumesOnDelete, volumes } from "./commands/volumes.ts"
import { status } from "./commands/status.ts"
import { upgrade } from "./commands/upgrade.ts"
import { buildK3sPlan } from "./k3s/plan.ts"
import { applyK3s, deleteK3s, kubeconfigK3s } from "./k3s/reconcile.ts"
import { buildMksPlan } from "./mks/plan.ts"
import { applyMks, deleteMks, kubeconfigMks, lookupMksInventory } from "./mks/reconcile.ts"
import { StorageEnv, storageLayers } from "./storage/env.ts"
import { bucketPlanActions, convergeBuckets, reconcileBucketsOnDelete } from "./storage/reconcile.ts"
import { decidePlanAction, renderPlan } from "./present.ts"
import { kumulo } from "./root.ts"

export { kumulo }

// The one distro-kind branch point; every command below dispatches on it
// the same way `upgrade.ts` already does.
const _isK3s = (config: ClusterConfig): boolean => config.distro === "k3s"

// Object storage is only wired for the ovh-mks path (scope.md) — k3s
// compiles against the same config shape but never converges buckets.
const _isOvhStorage = (config: ClusterConfig): boolean => !_isK3s(config) && config.object_storage.module === "ovh"

// Live plan for the ovh-mks path: cluster/pool existence via the OVH API,
// volume existence via Cinder — spec drift still converges through the
// idempotent ensure* verbs without showing here (see `buildMksPlan`).
const _mksPlanLive = (config: ClusterConfig) =>
  Effect.gen(function*() {
    const mks = yield* lookupMksInventory(config)
    const volumeNames = yield* lookupManagedVolumeNames(config)
    return buildMksPlan(config, { ...mks, volumeNames })
  })

/** Config → plan → present → apply, shared by `create` and `scale`. */
const _applyFlow = Effect.fn(function*() {
  const root = yield* kumulo
  const config = yield* loadConfig(root.config)
  const configDir = dirname(root.config)
  const storageLayer = _isOvhStorage(config) ? yield* storageLayers(config) : undefined
  const basePlan = _isK3s(config) ? buildK3sPlan(config) : yield* _mksPlanLive(config)
  const bucketActions = storageLayer === undefined
    ? []
    : yield* bucketPlanActions({ config, configDir }).pipe(Effect.provide(storageLayer))
  const plan: Plan = { actions: [...basePlan.actions, ...bucketActions] }
  const decision = decidePlanAction({ plan, yes: root.yes, dryRun: root.dryRun })
  yield* Console.log(renderPlan(plan))

  if (decision._tag === "DryRun" || decision._tag === "NothingToDo") return
  if (decision._tag === "NeedsConfirm") {
    yield* Console.log("\nRe-run with --yes to apply.")
    return
  }

  if (_isK3s(config)) {
    const result = yield* applyK3s({ config, configDir })
    yield* Console.log(`\nCluster "${config.name}" is up (${result.apiEndpoint}); kubeconfig at ${result.kubeconfigPath}.`)
    return
  }
  const info = yield* applyMks(config)
  yield* Console.log(`\nCluster "${config.name}" is ${info.status} (${info.apiEndpoint}).`)

  // Same Cinder-backed volumes as the k3s path's `_reconcileVolumes`
  // (`k3s/reconcile.ts`), just no cluster-side manifest apply yet — see
  // `convergeManagedVolumes`'s doc comment.
  yield* convergeManagedVolumes({ config, configDir })

  // Buckets converge only after the cluster is READY, credentials are
  // written last (R6/R7 ordering) — both handled inside `convergeBuckets`.
  if (storageLayer !== undefined) {
    yield* convergeBuckets({ config, configDir }).pipe(Effect.provide(storageLayer))
  }
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

    // Retained volumes (`volumes.managed[].retain: true`) survive `delete`;
    // anything else recorded there is torn down alongside the cluster.
    const kept = yield* reconcileVolumesOnDelete(config)
    if (kept.length > 0) yield* Console.log(`Retained volumes (kept): ${kept.join(", ")}`)

    // Same retain semantics for buckets (R6/R11) — a non-empty, non-retained
    // bucket surfaces `BucketNotEmpty` as-is, nothing else here rolls back.
    if (_isOvhStorage(config)) {
      const env = yield* StorageEnv
      const providerLayer = ovhObjectStorageProviderLive(env)
      const keptBuckets = yield* reconcileBucketsOnDelete({ config, configDir: dirname(root.config) }).pipe(
        Effect.provide(providerLayer)
      )
      if (keptBuckets.length > 0) yield* Console.log(`Retained buckets (kept): ${keptBuckets.join(", ")}`)
    }
  })
).pipe(Command.withDescription("Delete a cluster"))

export const kumuloCli = kumulo.pipe(
  Command.withSubcommands([create, scale, status, kubeconfig, del, upgrade, volumes])
)
