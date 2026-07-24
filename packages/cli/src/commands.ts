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
import { decidePlanAction, dim, green, red, renderPlan, yellow } from "./present.ts"
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
    return buildMksPlan({ config, inventory: { ...mks, volumeNames } })
  })

const _appliedVerb: Record<string, string> = {
  Create: green("Created"),
  Delete: red("Deleted"),
  ReplaceNeedsConfirm: yellow("Replaced")
}

/** One line per non-NoOp plan row whose name matches `prefixes`, logged after the corresponding converge step succeeded. */
const _logApplied = (
  { plan, prefixes }: { readonly plan: Plan; readonly prefixes: ReadonlyArray<string> }
): Effect.Effect<void> =>
  Effect.forEach(
    plan.actions.filter((action) =>
      action._tag !== "NoOp" && prefixes.some((prefix) => action.name.startsWith(prefix))
    ),
    (action) => Console.log(`${_appliedVerb[action._tag] ?? action._tag} ${action.name}`),
    { discard: true }
  )

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
  yield* Console.log(`${renderPlan(plan)}\n`)

  if (decision._tag === "DryRun" || decision._tag === "NothingToDo") return
  if (decision._tag === "NeedsConfirm") {
    yield* Console.log("Re-run with --yes to apply.")
    return
  }

  if (_isK3s(config)) {
    const result = yield* applyK3s({ config, configDir })
    yield* Console.log(`Cluster "${config.name}" is up (${result.apiEndpoint}); kubeconfig at ${result.kubeconfigPath}.`)
    return
  }
  // Cluster+pools, volumes, and buckets have no dependencies on each other
  // (pools depend on the cluster, sequenced inside `applyMks`; credentials
  // depend on buckets, sequenced inside `convergeBuckets`) — converge all
  // three concurrently.
  const mksStep = applyMks(config).pipe(
    Effect.tap((info) => Console.log(`Cluster "${config.name}" is ${info.status} (${info.apiEndpoint}).`)),
    Effect.tap(() => _logApplied({ plan, prefixes: ["mks-cluster/", "mks-pool/"] }))
  )
  // Same Cinder-backed volumes as the k3s path's `_reconcileVolumes`
  // (`k3s/reconcile.ts`), just no cluster-side manifest apply yet — see
  // `convergeManagedVolumes`'s doc comment.
  const volumesStep = convergeManagedVolumes({ config, configDir }).pipe(
    Effect.tap(() => _logApplied({ plan, prefixes: ["volume/"] }))
  )
  const bucketsStep = storageLayer === undefined
    ? Effect.void
    : convergeBuckets({ config, configDir }).pipe(
      Effect.provide(storageLayer),
      Effect.tap(() => _logApplied({ plan, prefixes: ["bucket/"] }))
    )
  yield* Effect.all([mksStep, volumesStep, bucketsStep], { concurrency: 3 })
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
    // Volumes must wait for the cluster (attachments); buckets don't — the
    // bucket teardown runs concurrently with cluster+volume teardown.
    const clusterAndVolumesStep = Effect.gen(function*() {
      if (_isK3s(config)) yield* deleteK3s(config)
      else yield* deleteMks(config)
      yield* Console.log(`${red("Deleted")} mks-cluster/${config.name}`)

      // Retained volumes (`volumes.managed[].retain: true`) survive `delete`;
      // anything else recorded there is torn down alongside the cluster.
      const volumesResult = yield* reconcileVolumesOnDelete(config)
      yield* Effect.forEach(volumesResult.deleted, (name) => Console.log(`${red("Deleted")} volume/${name}`), { discard: true })
      if (volumesResult.kept.length > 0) yield* Console.log(`${dim("Retained volumes (kept):")} ${volumesResult.kept.join(", ")}`)
    })

    // Same retain semantics for buckets (R6/R11) — a non-empty, non-retained
    // bucket surfaces `BucketNotEmpty` as-is, nothing else here rolls back.
    const bucketsStep = Effect.gen(function*() {
      if (!_isOvhStorage(config)) return
      const env = yield* StorageEnv
      const providerLayer = ovhObjectStorageProviderLive(env)
      const buckets = yield* reconcileBucketsOnDelete({ config, configDir: dirname(root.config) }).pipe(
        Effect.provide(providerLayer)
      )
      yield* Effect.forEach(buckets.deleted, (name) => Console.log(`${red("Deleted")} bucket/${name}`), { discard: true })
      if (buckets.kept.length > 0) yield* Console.log(`${dim("Retained buckets (kept):")} ${buckets.kept.join(", ")}`)
    })

    yield* Effect.all([clusterAndVolumesStep, bucketsStep], { concurrency: 2 })
    yield* Console.log(`Cluster "${config.name}" deleted.`)
  })
).pipe(Command.withDescription("Delete a cluster"))

export const kumuloCli = kumulo.pipe(
  Command.withSubcommands([create, scale, status, kubeconfig, del, upgrade, volumes])
)
