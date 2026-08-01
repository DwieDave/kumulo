import { dirname } from "node:path"
import { Console, Effect } from "effect"
import type { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import type { HttpClient } from "effect/unstable/http"
import { Command, Flag } from "effect/unstable/cli"
import type { VolumeError, VolumeSpec } from "@kumulo/core"
import type { ClusterConfig } from "../cluster-config.ts"
import { ConfigInvalid, VolumeProvider } from "@kumulo/core"
import {
  adoptVolume,
  listVolumes,
  readOutputs,
  upsertVolume,
  VolumeProviderLive,
  writeOutputs
} from "@kumulo/volumes-cinder"
import type { OutputsInvalid ,
  CinderAuth} from "@kumulo/volumes-cinder"
import { loadConfig } from "../config.ts"
import { configArgument } from "../root.ts"

const nameFlag = Flag.string("name").pipe(
  Flag.withDescription("Name of the retained volume, matching an entry in the config's volumes.managed list")
)
const volumeIdFlag = Flag.string("volume-id").pipe(
  Flag.withDescription("Existing Cinder volume ID to bind into this cluster's outputs + generated PVs")
)

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

type ManagedVolume = Exclude<ClusterConfig["volumes"], { readonly module: "none" }>["managed"][number]

export const managedVolumes = (config: ClusterConfig): ReadonlyArray<ManagedVolume> =>
  config.volumes.module === "none" ? [] : config.volumes.managed

const _retainedSpec = (config: ClusterConfig, name: string): VolumeSpec | undefined => {
  const entry = managedVolumes(config).find((candidate) => candidate.name === name)
  return entry === undefined ? undefined : { name: entry.name, sizeGb: entry.size_gb, type: entry.type, retain: entry.retain }
}

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

export const lookupManagedVolumeNames = (
  config: ClusterConfig
): Effect.Effect<ReadonlySet<string>, VolumeError, CinderAuth | HttpClient.HttpClient> =>
  Effect.gen(function*() {
    if (config.volumes.module !== "cinder" || config.volumes.managed.length === 0) return new Set<string>()
    const provider = yield* Effect.provide(VolumeProvider, VolumeProviderLive({ tag: config.name }))
    const existing = yield* provider.listClusterVolumes(config.name)
    return new Set(existing.map((volume) => volume.name))
  })

// Missing OS_* credentials surface as AuthenticationFailed, never a silent skip.
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

// Only deletes volumes present in volumes.managed — never discovers/deletes on its own.
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
