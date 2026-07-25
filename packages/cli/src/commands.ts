import { dirname } from "node:path"
import { Console, Effect } from "effect"
import { Command } from "effect/unstable/cli"
import type { Layer } from "effect"
import type { ClusterConfig, CredentialsSink, ObjectStorageProvider, Plan } from "@kumulo/core"
import { ovhObjectStorageProviderLive } from "@kumulo/storage-ovh"
import { loadConfig } from "./config.ts"
import { envSummary } from "./env-summary.ts"
import { convergeManagedVolumes, lookupManagedVolumeNames, reconcileVolumesOnDelete, volumes } from "./commands/volumes.ts"
import { status } from "./commands/status.ts"
import { upgrade } from "./commands/upgrade.ts"
import { distroFor, wantsObjectStorage } from "./distro/registry.ts"
import type { DistroEntry } from "./distro/types.ts"
import { StorageEnv, storageLayers } from "./storage/env.ts"
import { bucketDeletePlanActions, bucketPlanActions, convergeBuckets, reconcileBucketsOnDelete } from "./storage/reconcile.ts"
import { decidePlanAction, dim, green, red, renderPlan, yellow } from "./present.ts"
import { kumulo } from "./root.ts"

export { kumulo }

const _appliedVerb: Record<string, string> = {
  Create: green("Created"),
  Update: yellow("Updated"),
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

/**
 * Cluster+pools, volumes, and buckets have no dependencies on each other
 * (pools depend on the cluster, sequenced inside the distro's `apply`;
 * credentials depend on buckets, sequenced inside `convergeBuckets`) —
 * converge all three concurrently.
 */
const _convergeAll = Effect.fn(function*(
  { entry, config, configDir, plan, storageLayer }: {
    readonly entry: DistroEntry
    readonly config: ClusterConfig
    readonly configDir: string
    readonly plan: Plan
    readonly storageLayer: Layer.Layer<ObjectStorageProvider | CredentialsSink> | undefined
  }
) {
  const clusterStep = entry.apply({ config, configDir }).pipe(
    Effect.tap(() => _logApplied({ plan, prefixes: entry.appliedPrefixes }))
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
  const [result] = yield* Effect.all([clusterStep, volumesStep, bucketsStep], { concurrency: 3 })
  return result
})

/** Config → plan → present → apply, shared by `create` and `scale`. */
const _applyFlow = Effect.fn(function*() {
  const root = yield* kumulo
  const config = yield* loadConfig(root.config)
  const configDir = dirname(root.config)
  const entry = distroFor(config)
  yield* Console.log(`${yield* envSummary(config)}\n`)
  const storageLayer = wantsObjectStorage(config) ? yield* storageLayers(config) : undefined
  const basePlan = yield* entry.plan(config)
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

  // An entry with no applied prefixes converges everything itself (k3s
  // reconciles volumes inside `applyK3s`) — nothing to fan out here.
  if (entry.appliedPrefixes.length === 0) {
    const result = yield* entry.apply({ config, configDir })
    yield* Console.log(result.summary)
    return
  }
  const result = yield* _convergeAll({ entry, config, configDir, plan, storageLayer })
  yield* Console.log(result.summary)
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
    const result = yield* distroFor(config).kubeconfig(config)
    yield* Console.log(result.content)
  })
).pipe(Command.withDescription("Print the cluster's kubeconfig"))

// Delete plan: cluster + non-retained volumes as Delete rows; retained
// volumes as NoOp "(retained)"; buckets from the recorded outputs. Volume
// rows only appear for volumes that actually exist on Cinder right now.
const _deletePlan = Effect.fn(function*(config: ClusterConfig, configDir: string) {
  const [clusterActions, liveVolumes, bucketActions] = yield* Effect.all([
    distroFor(config).deletePlanActions(config),
    lookupManagedVolumeNames(config),
    bucketDeletePlanActions({ config, configDir })
  ], { concurrency: 3 })
  const volumeActions = config.volumes.managed
    .filter((entry) => liveVolumes.has(entry.name))
    .map((entry) =>
      entry.retain
        ? { _tag: "NoOp" as const, name: `volume/${entry.name} (retained)` }
        : { _tag: "Delete" as const, name: `volume/${entry.name}` }
    )
  const plan: Plan = { actions: [...clusterActions, ...volumeActions, ...bucketActions] }
  return plan
})

export const del = Command.make(
  "delete",
  {},
  Effect.fn(function*() {
    const root = yield* kumulo
    const config = yield* loadConfig(root.config)
    const entry = distroFor(config)

    yield* Console.log(`${yield* envSummary(config)}\n`)
    const plan = yield* _deletePlan(config, dirname(root.config))
    yield* Console.log(`${renderPlan(plan)}\n`)
    if (root.dryRun) return
    if (!root.yes) {
      yield* Console.log(`Re-run with --yes to delete cluster "${config.name}".`)
      return
    }
    // Volumes must wait for the cluster (attachments); buckets don't — the
    // bucket teardown runs concurrently with cluster+volume teardown.
    const clusterAndVolumesStep = Effect.gen(function*() {
      yield* entry.delete(config)
      yield* Console.log(`${red("Deleted")} ${entry.deletedLabel}/${config.name}`)
      yield* _logApplied({ plan, prefixes: ["mks-pool/"] })

      // Retained volumes (`volumes.managed[].retain: true`) survive `delete`;
      // anything else recorded there is torn down alongside the cluster.
      const volumesResult = yield* reconcileVolumesOnDelete(config)
      yield* Effect.forEach(volumesResult.deleted, (name) => Console.log(`${red("Deleted")} volume/${name}`), { discard: true })
      if (volumesResult.kept.length > 0) yield* Console.log(`${dim("Retained volumes (kept):")} ${volumesResult.kept.join(", ")}`)
    })

    // Same retain semantics for buckets (R6/R11) — a non-empty, non-retained
    // bucket surfaces `BucketNotEmpty` as-is, nothing else here rolls back.
    const bucketsStep = Effect.gen(function*() {
      if (!wantsObjectStorage(config)) return
      const env = yield* StorageEnv
      const providerLayer = ovhObjectStorageProviderLive(env)
      const buckets = yield* reconcileBucketsOnDelete({ config, configDir: dirname(root.config) }).pipe(
        Effect.provide(providerLayer)
      )
      yield* Effect.forEach(buckets.deleted, (name) => Console.log(`${red("Deleted")} bucket/${name}`), { discard: true })
      if (buckets.kept.length > 0) yield* Console.log(`${dim("Retained buckets (kept):")} ${buckets.kept.join(", ")}`)
    })

    yield* Effect.all([clusterAndVolumesStep, bucketsStep], { concurrency: 2 })
    yield* Console.log(`\nCluster "${config.name}" deleted.`)
  })
).pipe(Command.withDescription("Delete a cluster"))

export const kumuloCli = kumulo.pipe(
  Command.withSubcommands([create, scale, status, kubeconfig, del, upgrade, volumes])
)
