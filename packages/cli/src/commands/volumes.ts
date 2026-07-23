import { dirname } from "node:path"
import { Console, Effect } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { Command, Flag } from "effect/unstable/cli"
import type { ClusterConfig, VolumeError, VolumeSpec } from "@kumulo/core"
import { ConfigInvalid, VolumeProvider } from "@kumulo/core"
import { adoptVolume, CinderAuth, listVolumes, readOutputs, VolumeProviderLive, writeOutputs } from "@kumulo/volumes-cinder"
import { loadConfig } from "../config.ts"

const configFlag = Flag.string("config").pipe(
  Flag.withAlias("c"),
  Flag.withDescription("Path to the cluster YAML config")
)
const nameFlag = Flag.string("name").pipe(
  Flag.withDescription("Name of the retained volume, matching an entry in the config's volumes.retained list")
)
const volumeIdFlag = Flag.string("volume-id").pipe(
  Flag.withDescription("Existing Cinder volume ID to bind into this cluster's outputs + generated PVs")
)

/** FR-8.3 — `kumulo volumes list`: pure projection of `<cluster>.outputs.yaml`. */
export const volumesList = Command.make(
  "list",
  { config: configFlag },
  Effect.fn(function*({ config: configPath }) {
    const config = yield* loadConfig(configPath)
    const outputs = yield* readOutputs({ dir: dirname(configPath), tag: config.name })
    const volumes = listVolumes(outputs)
    if (volumes.length === 0) {
      yield* Console.log(`No recorded volumes for cluster "${config.name}".`)
      return
    }
    yield* Console.log(
      volumes.map((v) => `${v.name}  id=${v.id}  retain=${v.retain}`).join("\n")
    )
  })
).pipe(Command.withDescription("List recorded volumes for a cluster (FR-8.3)"))

const _retainedSpec = (config: ClusterConfig, name: string): VolumeSpec | undefined => {
  const entry = config.volumes.retained.find((candidate) => candidate.name === name)
  return entry === undefined ? undefined : { name: entry.name, sizeGb: entry.size_gb, type: entry.type, retain: entry.retain }
}

/**
 * FR-8.3 — `kumulo volumes adopt`: re-binds an existing Cinder volume ID
 * into this cluster's outputs file + regenerates its static PV(+PVC)
 * manifest, pinned to that volume's `csi.volumeHandle`. No Cinder call
 * needed (the volume already exists) — the spec (size/type/retain/pvc)
 * comes from the config's own `volumes.retained[]` entry matching `--name`,
 * not duplicate CLI flags.
 */
export const volumesAdopt = Command.make(
  "adopt",
  { config: configFlag, name: nameFlag, volumeId: volumeIdFlag },
  Effect.fn(function*({ config: configPath, name, volumeId }) {
    const config = yield* loadConfig(configPath)
    const spec = _retainedSpec(config, name)
    if (spec === undefined) {
      return yield* Effect.fail(
        new ConfigInvalid({ issues: [{ path: ["volumes", "retained"], message: `no retained volume named "${name}"` }] })
      )
    }
    const entry = config.volumes.retained.find((candidate) => candidate.name === name)
    const dir = dirname(configPath)
    const file = yield* readOutputs({ dir, tag: config.name })
    const pvc = entry?.pvc === undefined ? undefined : { namespace: entry.pvc.namespace, accessModes: entry.pvc.access_modes }
    const { outputs, manifests } = adoptVolume({ file, volumeId, spec, pvc })
    yield* writeOutputs({ dir, file: outputs })
    yield* Console.log(manifests.map((manifest) => JSON.stringify(manifest, null, 2)).join("\n---\n"))
    yield* Console.log(`\nAdopted volume "${name}" (${volumeId}) into ${config.name}'s outputs.`)
  })
).pipe(Command.withDescription("Bind an existing volume ID into a cluster's generated PVs (FR-8.3)"))

export const volumes = Command.make("volumes").pipe(
  Command.withSubcommands([volumesList, volumesAdopt]),
  Command.withDescription("Manage retained volumes across cluster rebuilds")
)

/**
 * AC-7 — `delete` skips `retain: true` volumes; called by `del` in
 * `commands.ts` after the cluster itself is torn down. Non-retained
 * volumes with a matching config entry are deleted; anything not present
 * in `volumes.retained` (or module !== "cinder") is left untouched — this
 * command never discovers/deletes volumes it wasn't told about.
 */
export const reconcileVolumesOnDelete = (
  config: ClusterConfig
): Effect.Effect<ReadonlyArray<string>, VolumeError, CinderAuth | HttpClient.HttpClient> =>
  Effect.gen(function*() {
    if (config.volumes.module !== "cinder" || config.volumes.retained.length === 0) return []
    const provider = yield* Effect.provide(VolumeProvider, VolumeProviderLive({ tag: config.name }))
    const existing = yield* provider.listClusterVolumes(config.name)
    const kept: Array<string> = []
    for (const entry of config.volumes.retained) {
      const vol = existing.find((v) => v.name === entry.name)
      if (vol === undefined) continue
      if (entry.retain) {
        kept.push(vol.name)
        continue
      }
      yield* provider.deleteVolume({ id: vol.id })
    }
    return kept
  })
