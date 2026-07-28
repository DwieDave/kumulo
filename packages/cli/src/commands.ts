import { dirname } from "node:path"
import { Console, Effect } from "effect"
import { Command, Prompt } from "effect/unstable/cli"
import type { Layer } from "effect"
import { genericProfileLive, namesToReplace, PlanRejected, ProviderProfile } from "@kumulo/core"
import type { ClusterConfig, ClusterConfigShape, ConfigInvalid, CredentialsSink, ObjectStorageProvider, Plan } from "@kumulo/core"
import { ovhObjectStorageProviderLive } from "@kumulo/storage-ovh"
import { ovhProfileLive } from "@kumulo/provider-ovh"
import { hetznerProfileLive } from "@kumulo/hetzner"
import { readOutputs, setIngress, writeOutputs } from "@kumulo/volumes-cinder"
import type { OutputsIngress, OutputsInvalid } from "@kumulo/volumes-cinder"
import type { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import { loadConfig } from "./config.ts"
import { envSummary } from "./env-summary.ts"
import {
  convergeManagedVolumes,
  lookupManagedVolumeNames,
  managedVolumes,
  reconcileVolumesOnDelete,
  volumes
} from "./commands/volumes.ts"
import { status } from "./commands/status.ts"
import { upgrade } from "./commands/upgrade.ts"
import { distroFor, onDistro, wantsObjectStorage } from "./distro/registry.ts"
import type { DistroApplyResult, DistroFailure, DistroServices } from "./distro/types.ts"
import { StorageEnv, storageLayers } from "./storage/env.ts"
import { bucketDeletePlanActions, bucketPlanActions, convergeBuckets, reconcileBucketsOnDelete } from "./storage/reconcile.ts"
import { decidePlanAction, dim, green, orderedActions, red, renderActionLine, renderPlan, yellow } from "./present.ts"
import { logLine, withPlanView, withRowProgress, withSpinner } from "./spinner.ts"
import { configArgument, kumulo } from "./root.ts"

export { kumulo }

/**
 * Interactive confirm on a TTY; otherwise print `fallback` (the --yes hint)
 * and answer no. Ctrl-C / quit counts as no.
 */
const _confirm = (
  { fallback, message }: { readonly message: string; readonly fallback: string }
): Effect.Effect<boolean, never, Prompt.Environment> =>
  process.stdout.isTTY
    ? Prompt.run(Prompt.confirm({ message })).pipe(Effect.catch(() => Effect.succeed(false)))
    : Console.log(fallback).pipe(Effect.as(false))

/** The provider's `ProviderProfile` — OVH's capabilities are per-region, so it takes `auth.region`. */
const _profileLayer = (config: ClusterConfig): Layer.Layer<ProviderProfile> =>
  config.provider === "ovh"
    ? ovhProfileLive(config.auth.region)
    : config.provider === "hetzner"
    ? hetznerProfileLive
    : genericProfileLive

/**
 * `ClusterConfigShape` slice for `validate`: mks configs carry no
 * `addons`/`api_server` block and `module: "none"` carries no `managed` list,
 * so the optional parts are filled in explicitly instead of cast.
 */
const _profileShape = (config: ClusterConfig): ClusterConfigShape => ({
  distro: config.distro,
  worker_pools: config.worker_pools,
  auth: { region: config.auth.region },
  // OVH fixes MKS's CNI, so the cilium rule can only ever trip on k3s.
  addons: config.distro === "k3s" ? config.addons : { cni: "flannel" },
  ...(config.distro === "k3s" ? { api_server: { high_availability: config.api_server.high_availability } } : {}),
  ...(config.volumes.module === "none" ? {} : { volumes: { managed: config.volumes.managed } })
})

/**
 * Provider-specific config rules (HA in a region without Octavia, unknown
 * hcloud location, unsupported volume type) — rejected before anything is
 * planned or touched.
 */
const _validateForProvider = (config: ClusterConfig): Effect.Effect<void, ConfigInvalid> =>
  Effect.gen(function*() {
    const profile = yield* ProviderProfile
    yield* profile.validate(_profileShape(config))
  }).pipe(Effect.provide(_profileLayer(config)))

const _planPhrases: ReadonlyArray<string> = [
  "Counting clouds...",
  "Untangling YAML...",
  "Consulting the scheduler...",
  "Herding pods...",
  "Negotiating with the control plane...",
  "Politely asking OVH...",
  "Rehearsing the plan..."
]

/** Progress line for non-TTY output only — the live plan view covers it on a TTY. */
const _ciLine = (message: string): Effect.Effect<void> => process.stdout.isTTY ? Effect.void : logLine(message)

/** Live-view rows in `renderPlan`'s display order; NoOp rows stay static. */
const _viewRows = (plan: Plan): ReadonlyArray<{ name: string; text: string; active: boolean }> =>
  orderedActions(plan).map((action) => ({
    name: action.name,
    text: renderActionLine(action),
    active: action._tag !== "NoOp"
  }))

const _appliedVerb: Record<string, string> = {
  Create: green("Created"),
  Update: yellow("Updated"),
  Delete: red("Deleted"),
  ReplaceNeedsConfirm: yellow("Replaced")
}

/**
 * One line per non-NoOp plan row whose name matches `prefixes`, logged after
 * the corresponding converge step succeeded. Non-TTY only — on a TTY the live
 * plan view checks the rows off in place instead.
 */
const _logApplied = (
  { plan, prefixes }: { readonly plan: Plan; readonly prefixes: ReadonlyArray<string> }
): Effect.Effect<void> =>
  process.stdout.isTTY ? Effect.void : Effect.forEach(
    plan.actions.filter((action) =>
      action._tag !== "NoOp" && prefixes.some((prefix) => action.name.startsWith(prefix))
    ),
    (action) => logLine(`${_appliedVerb[action._tag] ?? action._tag} ${action.name}`),
    { discard: true }
  )

/**
 * The ingress LB's ids into `<cluster>.outputs.yaml` (R13), so a consumer can
 * annotate a Service with `loadbalancer.openstack.org/load-balancer-id`.
 *
 * Deliberately NOT written from inside the distro's apply: that runs
 * concurrently with `convergeManagedVolumes`, which read-modify-writes the same
 * file, and `stringifyOutputs` rebuilds it from a fixed literal — so an
 * interleaved write loses one side's data silently. Sequencing it after every
 * converge step is the whole fix.
 */
export const recordIngressOutputs = (
  { config, configDir, ingress }: {
    readonly config: ClusterConfig
    readonly configDir: string
    readonly ingress: OutputsIngress | undefined
  }
): Effect.Effect<void, OutputsInvalid | PlatformError, FileSystem> =>
  Effect.gen(function*() {
    if (ingress === undefined) return
    const format = config.outputs?.format
    const file = yield* readOutputs({ dir: configDir, tag: config.name, format })
    yield* writeOutputs({ dir: configDir, file: setIngress({ file, ingress }), format })
  })

/**
 * Cluster+pools, volumes, and buckets have no dependencies on each other
 * (pools depend on the cluster, sequenced inside the distro's `apply`;
 * credentials depend on buckets, sequenced inside `convergeBuckets`) —
 * converge all three concurrently.
 */
const _convergeAll = Effect.fn(function*(
  { apply, appliedPrefixes, config, configDir, plan, storageLayer }: {
    readonly apply: Effect.Effect<DistroApplyResult, DistroFailure, DistroServices>
    readonly appliedPrefixes: ReadonlyArray<string>
    readonly config: ClusterConfig
    readonly configDir: string
    readonly plan: Plan
    readonly storageLayer: Layer.Layer<ObjectStorageProvider | CredentialsSink> | undefined
  }
) {
  const clusterStep = withRowProgress({
    match: (name) => appliedPrefixes.some((prefix) => name.startsWith(prefix)),
    effect: apply
  }).pipe(
    Effect.tap(() => _logApplied({ plan, prefixes: appliedPrefixes }))
  )
  // Same Cinder-backed volumes as the k3s path's `_reconcileVolumes`
  // (`k3s/reconcile.ts`), just no cluster-side manifest apply yet — see
  // `convergeManagedVolumes`'s doc comment.
  const volumesStep = withRowProgress({
    match: (name) => name.startsWith("volume/"),
    effect: convergeManagedVolumes({ config, configDir })
  }).pipe(
    Effect.tap(() => _logApplied({ plan, prefixes: ["volume/"] }))
  )
  const bucketsStep = storageLayer === undefined
    ? Effect.void
    : withRowProgress({
      match: (name) => name.startsWith("bucket/"),
      effect: convergeBuckets({ config, configDir }).pipe(Effect.provide(storageLayer))
    }).pipe(
      Effect.tap(() => _logApplied({ plan, prefixes: ["bucket/"] }))
    )
  const [result] = yield* Effect.all([clusterStep, volumesStep, bucketsStep], { concurrency: 3 })
  yield* recordIngressOutputs({ config, configDir, ingress: result.ingress })
  return result
})

/**
 * Declining a plan (a non-TTY answers no, see `_confirm`) is a no-op for
 * creates — but a plan that would replace nodes fails closed, so drift is
 * never silently skipped in CI.
 */
export const rejectUnconfirmedReplace = (plan: Plan): Effect.Effect<void, PlanRejected> =>
  namesToReplace(plan).size === 0
    ? Effect.void
    : Effect.fail(
      new PlanRejected({
        reason: `${namesToReplace(plan).size} node(s) need replacing and the change was not confirmed; re-run with --yes to apply`
      })
    )

/** Config → plan → present → apply, shared by `apply` and `scale`. */
const _applyFlow = Effect.fn(function*({ config: configPath }: { readonly config: string }) {
  const root = yield* kumulo
  const config = yield* loadConfig(configPath)
  yield* _validateForProvider(config)
  const configDir = dirname(configPath)
  const { appliedPrefixes } = distroFor(config)
  if (root.showEnv) yield* Console.log(`${yield* envSummary(config)}\n`)
  const storageLayer = wantsObjectStorage(config) ? yield* storageLayers(config) : undefined
  const plan: Plan = yield* withSpinner({
    label: _planPhrases,
    effect: Effect.gen(function*() {
      const basePlan = yield* onDistro(config)(({ config: cfg, entry }) => entry.plan(cfg))
      const bucketActions = storageLayer === undefined
        ? []
        : yield* bucketPlanActions({ config, configDir }).pipe(Effect.provide(storageLayer))
      return { actions: [...basePlan.actions, ...bucketActions] }
    })
  })
  const decision = decidePlanAction({ plan, yes: root.yes, dryRun: root.dryRun })
  yield* Console.log(`${renderPlan(plan)}\n`)

  if (decision._tag === "DryRun" || decision._tag === "NothingToDo") return
  if (decision._tag === "NeedsConfirm") {
    const proceed = yield* _confirm({ message: "Apply these changes?", fallback: "Re-run with --yes to apply." })
    if (!proceed) return yield* rejectUnconfirmedReplace(plan)
  }
  // Replaces only ever execute past the confirm gate above (`--yes` or an
  // answered prompt); the distro never re-derives them from the inventory.
  const replace = namesToReplace(plan)
  // The distro's config-taking members, bound to this config's variant once.
  const applyStep = onDistro(config)(({ config: cfg, entry }) => entry.apply({ config: cfg, configDir, replace }))

  // Trailing blank line, plus the confirm prompt's submitted line if we asked.
  const view = {
    rows: _viewRows(plan),
    offset: decision._tag === "NeedsConfirm" ? 2 : 1
  }
  // An entry with no applied prefixes converges everything itself (k3s
  // reconciles volumes inside `applyK3s`) — one opaque apply, all rows spin together.
  const result = yield* withPlanView({
    ...view,
    effect: appliedPrefixes.length === 0
      ? withRowProgress({ match: () => true, effect: applyStep })
      : _convergeAll({ apply: applyStep, appliedPrefixes, config, configDir, plan, storageLayer })
  })
  yield* Console.log(result.summary)
})

export const apply = Command.make("apply", { config: configArgument() }, _applyFlow).pipe(
  Command.withDescription("Create or converge a cluster onto its config (yaml or json)")
)

export const scale = Command.make("scale", { config: configArgument() }, _applyFlow).pipe(
  Command.withDescription("Converge worker pool sizes onto the config (same reconcile as apply)")
)

export const kubeconfig = Command.make(
  "kubeconfig",
  { config: configArgument() },
  Effect.fn(function*({ config: configPath }) {
    const config = yield* loadConfig(configPath)
    const result = yield* onDistro(config)(({ config: cfg, entry }) => entry.kubeconfig(cfg))
    yield* Console.log(result.content)
  })
).pipe(Command.withDescription("Print the cluster's kubeconfig"))

// Delete plan: cluster + non-retained volumes as Delete rows; retained
// volumes as NoOp "(retained)"; buckets from the recorded outputs. Volume
// rows only appear for volumes that actually exist on Cinder right now.
const _deletePlan = Effect.fn(function*(config: ClusterConfig, configDir: string) {
  const [clusterActions, liveVolumes, bucketActions] = yield* Effect.all([
    onDistro(config)(({ config: cfg, entry }) => entry.deletePlanActions(cfg)),
    lookupManagedVolumeNames(config),
    bucketDeletePlanActions({ config, configDir })
  ], { concurrency: 3 })
  const volumeActions = managedVolumes(config)
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
  { config: configArgument() },
  Effect.fn(function*({ config: configPath }) {
    const root = yield* kumulo
    const config = yield* loadConfig(configPath)
    const { deletedLabel } = distroFor(config)

    if (root.showEnv) yield* Console.log(`${yield* envSummary(config)}\n`)
    const plan = yield* withSpinner({ label: _planPhrases, effect: _deletePlan(config, dirname(configPath)) })
    yield* Console.log(`${renderPlan(plan)}\n`)
    if (root.dryRun) return
    if (!root.yes) {
      const proceed = yield* _confirm({
        message: `Delete cluster "${config.name}"?`,
        fallback: `Re-run with --yes to delete cluster "${config.name}".`
      })
      if (!proceed) return
    }
    // Volumes must wait for the cluster (attachments); buckets don't — the
    // bucket teardown runs concurrently with cluster+volume teardown.
    const clusterAndVolumesStep = Effect.gen(function*() {
      yield* withRowProgress({
        match: (name) => !name.startsWith("volume/") && !name.startsWith("bucket/"),
        effect: onDistro(config)(({ config: cfg, entry }) => entry.delete(cfg))
      })
      yield* _ciLine(`${red("Deleted")} ${deletedLabel}/${config.name}`)
      yield* _logApplied({ plan, prefixes: ["mks-pool/"] })

      // Retained volumes (`volumes.managed[].retain: true`) survive `delete`;
      // anything else recorded there is torn down alongside the cluster.
      const volumesResult = yield* withRowProgress({
        match: (name) => name.startsWith("volume/"),
        effect: reconcileVolumesOnDelete(config)
      })
      yield* Effect.forEach(volumesResult.deleted, (name) => _ciLine(`${red("Deleted")} volume/${name}`), { discard: true })
      if (volumesResult.kept.length > 0) yield* _ciLine(`${dim("Retained volumes (kept):")} ${volumesResult.kept.join(", ")}`)
    })

    // Same retain semantics for buckets (R6/R11) — a non-empty, non-retained
    // bucket surfaces `BucketNotEmpty` as-is, nothing else here rolls back.
    const bucketsStep = Effect.gen(function*() {
      if (!wantsObjectStorage(config)) return
      const env = yield* StorageEnv
      const providerLayer = ovhObjectStorageProviderLive(env)
      const buckets = yield* withRowProgress({
        match: (name) => name.startsWith("bucket/"),
        effect: reconcileBucketsOnDelete({ config, configDir: dirname(configPath) }).pipe(Effect.provide(providerLayer))
      })
      yield* Effect.forEach(buckets.deleted, (name) => _ciLine(`${red("Deleted")} bucket/${name}`), { discard: true })
      if (buckets.kept.length > 0) yield* _ciLine(`${dim("Retained buckets (kept):")} ${buckets.kept.join(", ")}`)
    })

    yield* withPlanView({
      rows: _viewRows(plan),
      offset: root.yes ? 1 : 2,
      effect: Effect.all([clusterAndVolumesStep, bucketsStep], { concurrency: 2 })
    })
    yield* Console.log(`\nCluster "${config.name}" deleted.`)
  })
).pipe(Command.withDescription("Delete a cluster"))

export const kumuloCli = kumulo.pipe(
  Command.withSubcommands([apply, scale, status, kubeconfig, del, upgrade, volumes])
)
