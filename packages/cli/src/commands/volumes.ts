import { dirname } from "node:path"
import { Console, Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import type { HttpClient } from "effect/unstable/http"
import { Command, Flag } from "effect/unstable/cli"
import type { ClusterConfig, VolumeError, VolumeSpec } from "@kumulo/core"
import { ConfigInvalid, VolumeProvider } from "@kumulo/core"
import {
  adoptVolume,
  CinderAuth,
  listVolumes,
  readOutputs,
  upsertVolume,
  VolumeProviderLive,
  writeOutputs
} from "@kumulo/volumes-cinder"
import type { OutputsInvalid } from "@kumulo/volumes-cinder"
import { loadConfig } from "../config.ts"
import { configArgument } from "../root.ts"

const nameFlag = Flag.string("name").pipe(
  Flag.withDescription("Name of the retained volume, matching an entry in the config's volumes.managed list")
)
const volumeIdFlag = Flag.string("volume-id").pipe(
  Flag.withDescription("Existing Cinder volume ID to bind into this cluster's outputs + generated PVs")
)

/** `kumulo volumes list`: pure projection of `<cluster>.outputs.yaml`. */
export const volumesList = Command.make(
  "list",
  { config: configArgument() },
  Effect.fn(function*({ config: configPath }) {
    const config = yield* loadConfig(configPath)
    const outputs = yield* readOutputs({ dir: dirname(configPath), tag: config.name, format: config.outputs?.format })
    const volumes = listVolumes(outputs)
    if (volumes.length === 0) {
      yield* Console.log(`No recorded volumes for cluster "${config.name}".`)
      return
    }
    yield* Console.log(
      volumes.map((v) => `${v.name}  id=${v.id}  retain=${v.retain}`).join("\n")
    )
  })
).pipe(Command.withDescription("List recorded volumes for a cluster"))

/** One `volumes.managed[]` entry — only the non-`none` variants of the union carry them. */
type ManagedVolume = Exclude<ClusterConfig["volumes"], { readonly module: "none" }>["managed"][number]

/** `volumes.managed` behind the union discriminant: empty for `module: none`. */
export const managedVolumes = (config: ClusterConfig): ReadonlyArray<ManagedVolume> =>
  config.volumes.module === "none" ? [] : config.volumes.managed

const _retainedSpec = (config: ClusterConfig, name: string): VolumeSpec | undefined => {
  const entry = managedVolumes(config).find((candidate) => candidate.name === name)
  return entry === undefined ? undefined : { name: entry.name, sizeGb: entry.size_gb, type: entry.type, retain: entry.retain }
}

/**
 * `kumulo volumes adopt`: re-binds an existing Cinder volume ID
 * into this cluster's outputs file + regenerates its static PV(+PVC)
 * manifest, pinned to that volume's `csi.volumeHandle`. No Cinder call
 * needed (the volume already exists) — the spec (size/type/retain/pvc)
 * comes from the config's own `volumes.managed[]` entry matching `--name`,
 * not duplicate CLI flags.
 */
export const volumesAdopt = Command.make(
  "adopt",
  { config: configArgument(), name: nameFlag, volumeId: volumeIdFlag },
  Effect.fn(function*({ config: configPath, name, volumeId }) {
    const config = yield* loadConfig(configPath)
    const spec = _retainedSpec(config, name)
    if (spec === undefined) {
      return yield* Effect.fail(
        new ConfigInvalid({ issues: [{ path: ["volumes", "managed"], message: `no retained volume named "${name}"` }] })
      )
    }
    const entry = managedVolumes(config).find((candidate) => candidate.name === name)
    const dir = dirname(configPath)
    const file = yield* readOutputs({ dir, tag: config.name, format: config.outputs?.format })
    const pvc = entry?.pvc === undefined ? undefined : { namespace: entry.pvc.namespace, accessModes: entry.pvc.access_modes }
    const { outputs, manifests } = adoptVolume({ file, volumeId, spec, pvc })
    yield* writeOutputs({ dir, file: outputs, format: config.outputs?.format })
    yield* Console.log(manifests.map((manifest) => JSON.stringify(manifest, null, 2)).join("\n---\n"))
    yield* Console.log(`\nAdopted volume "${name}" (${volumeId}) into ${config.name}'s outputs.`)
  })
).pipe(Command.withDescription("Bind an existing volume ID into a cluster's generated PVs"))

export const volumes = Command.make("volumes").pipe(
  Command.withSubcommands([volumesList, volumesAdopt]),
  Command.withDescription("Manage retained volumes across cluster rebuilds")
)

const _toManagedSpec = (entry: ManagedVolume): VolumeSpec => ({
  name: entry.name,
  sizeGb: entry.size_gb,
  type: entry.type,
  retain: entry.retain
})

/** Names of the cluster's live Cinder volumes for the plan — empty (no OpenStack call) when nothing is managed. */
export const lookupManagedVolumeNames = (
  config: ClusterConfig
): Effect.Effect<ReadonlySet<string>, VolumeError, CinderAuth | HttpClient.HttpClient> =>
  Effect.gen(function*() {
    if (config.volumes.module !== "cinder" || config.volumes.managed.length === 0) return new Set<string>()
    const provider = yield* Effect.provide(VolumeProvider, VolumeProviderLive({ tag: config.name }))
    const existing = yield* provider.listClusterVolumes(config.name)
    return new Set(existing.map((volume) => volume.name))
  })

/**
 * `create`/`scale` (mks path): converges `volumes.managed` via the Cinder
 * `VolumeProvider`, same as `k3sVolumeProviderLayer`'s `_reconcileVolumes`,
 * recording ids in `<cluster>.outputs.yaml` (the same outputs file
 * `reconcileVolumesOnDelete`/`volumes adopt` read/write). No-op when
 * `volumes.module` isn't `cinder` or nothing is managed; missing `OS_*`
 * credentials surface as `AuthenticationFailed` from `CinderAuth` itself
 * (see `volumes/env.ts`), never a silent skip.
 *
 * TODO(mks-volumes): the mks CLI path has no manifest-apply mechanism yet
 * (unlike k3s's `installAddons`, run against a fetched kubeconfig) — once one
 * exists, apply `staticVolumeManifests` here too instead of only recording ids.
 */
export const convergeManagedVolumes = (
  { config, configDir }: { readonly config: ClusterConfig; readonly configDir: string }
): Effect.Effect<void, VolumeError | OutputsInvalid | PlatformError, CinderAuth | HttpClient.HttpClient | FileSystem> =>
  Effect.gen(function*() {
    if (config.volumes.module !== "cinder" || config.volumes.managed.length === 0) return
    const provider = yield* Effect.provide(VolumeProvider, VolumeProviderLive({ tag: config.name }))
    const file = yield* readOutputs({ dir: configDir, tag: config.name, format: config.outputs?.format })
    const ensured = yield* Effect.forEach(config.volumes.managed, (entry) =>
      provider.ensureVolume(_toManagedSpec(entry)).pipe(
        Effect.map((info) => ({ name: entry.name, id: info.id, retain: entry.retain }))
      ), { concurrency: 4 })
    const outputs = ensured.reduce((acc, volume) => upsertVolume({ file: acc, volume }), file)
    yield* writeOutputs({ dir: configDir, file: outputs, format: config.outputs?.format })
  })

/**
 * `delete` skips `retain: true` volumes; called by `del` in
 * `commands.ts` after the cluster itself is torn down. Non-retained
 * volumes with a matching config entry are deleted; anything not present
 * in `volumes.managed` (or module !== "cinder") is left untouched — this
 * command never discovers/deletes volumes it wasn't told about.
 */
export const reconcileVolumesOnDelete = (
  config: ClusterConfig
): Effect.Effect<
  { readonly kept: ReadonlyArray<string>; readonly deleted: ReadonlyArray<string> },
  VolumeError,
  CinderAuth | HttpClient.HttpClient
> =>
  Effect.gen(function*() {
    if (config.volumes.module !== "cinder" || config.volumes.managed.length === 0) return { kept: [], deleted: [] }
    const provider = yield* Effect.provide(VolumeProvider, VolumeProviderLive({ tag: config.name }))
    const existing = yield* provider.listClusterVolumes(config.name)
    const kept: Array<string> = []
    const deleted: Array<string> = []
    for (const entry of config.volumes.managed) {
      const vol = existing.find((v) => v.name === entry.name)
      if (vol === undefined) continue
      if (entry.retain) {
        kept.push(vol.name)
        continue
      }
      yield* provider.deleteVolume({ id: vol.id })
      deleted.push(vol.name)
    }
    return { kept, deleted }
  })
