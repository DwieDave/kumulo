import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import { parse, stringify } from "yaml"
import type { ClusterTag } from "@kumulo/core"

// FR-8.2 — stable volume IDs written to `<cluster>.outputs.yaml`.
export const OutputsVolume = Schema.Struct({
  name: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  retain: Schema.Boolean
})
export type OutputsVolume = Schema.Schema.Type<typeof OutputsVolume>

export const OutputsFile = Schema.Struct({
  cluster: Schema.NonEmptyString,
  volumes: Schema.Array(OutputsVolume)
})
export type OutputsFile = Schema.Schema.Type<typeof OutputsFile>

export class OutputsInvalid extends Data.TaggedError("OutputsInvalid")<{
  readonly message: string
}> {}

export const outputsPath = ({ dir, tag }: { readonly dir: string; readonly tag: ClusterTag }): string =>
  `${dir.endsWith("/") ? dir.slice(0, -1) : dir}/${tag}.outputs.yaml`

export const decodeOutputs = (input: unknown): Effect.Effect<OutputsFile, OutputsInvalid> =>
  Schema.decodeUnknownEffect(OutputsFile)(input).pipe(
    Effect.mapError((cause) => new OutputsInvalid({ message: String(cause) }))
  )

export const parseOutputsYaml = (text: string): Effect.Effect<OutputsFile, OutputsInvalid> =>
  Effect.try({ try: () => parse(text), catch: (cause) => new OutputsInvalid({ message: String(cause) }) }).pipe(
    Effect.flatMap(decodeOutputs)
  )

// kumulo: stable key ordering (cluster, volumes) — regenerating from
// unchanged state is a byte-identical diff (NFR-5-style guarantee for outputs).
export const stringifyOutputsYaml = (file: OutputsFile): string => stringify({ cluster: file.cluster, volumes: file.volumes })

export const emptyOutputs = (tag: ClusterTag): OutputsFile => ({ cluster: tag, volumes: [] })

// kumulo: missing file reads as "no volumes recorded yet", not an error —
// first `ensureVolume` on a fresh cluster always starts from an empty file.
export const readOutputs = (
  { dir, tag }: { readonly dir: string; readonly tag: ClusterTag }
): Effect.Effect<OutputsFile, OutputsInvalid | PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const exists = yield* fs.exists(outputsPath({ dir, tag }))
    if (!exists) return emptyOutputs(tag)
    const text = yield* fs.readFileString(outputsPath({ dir, tag }))
    return yield* parseOutputsYaml(text)
  })

export const writeOutputs = (
  { dir, file }: { readonly dir: string; readonly file: OutputsFile }
): Effect.Effect<void, PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    yield* fs.writeFileString(outputsPath({ dir, tag: file.cluster }), stringifyOutputsYaml(file))
  })

// Pure merge: create-or-update by volume name (used after `ensureVolume`).
export const upsertVolume = (
  { file, volume }: { readonly file: OutputsFile; readonly volume: OutputsVolume }
): OutputsFile => ({
  cluster: file.cluster,
  volumes: [...file.volumes.filter((existing: OutputsVolume) => existing.name !== volume.name), volume]
})

// Pure remove (only called for volumes actually deleted — never `retain: true`).
export const removeVolume = ({ file, name }: { readonly file: OutputsFile; readonly name: string }): OutputsFile => ({
  cluster: file.cluster,
  volumes: file.volumes.filter((existing: OutputsVolume) => existing.name !== name)
})
