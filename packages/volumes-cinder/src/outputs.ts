import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import { parse, stringify } from "yaml"
import type { ClusterTag, OutputsFormat } from "@kumulo/core"

// kumulo: stable volume IDs written to `<cluster>.outputs.yaml`.
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

export const outputsPath = (
  { dir, format = "yaml", tag }: { readonly dir: string; readonly tag: ClusterTag; readonly format?: OutputsFormat }
): string => `${dir.endsWith("/") ? dir.slice(0, -1) : dir}/${tag}.outputs.${format}`

export const decodeOutputs = (input: unknown): Effect.Effect<OutputsFile, OutputsInvalid> =>
  Schema.decodeUnknownEffect(OutputsFile)(input).pipe(
    Effect.mapError((cause) => new OutputsInvalid({ message: String(cause) }))
  )

// YAML is a superset of JSON, so this parses both formats.
export const parseOutputsYaml = (text: string): Effect.Effect<OutputsFile, OutputsInvalid> =>
  Effect.try({ try: () => parse(text), catch: (cause) => new OutputsInvalid({ message: String(cause) }) }).pipe(
    Effect.flatMap(decodeOutputs)
  )

// kumulo: stable key ordering (cluster, volumes) — regenerating from
// unchanged state is a byte-identical diff.
export const stringifyOutputs = (
  { file, format = "yaml" }: { readonly file: OutputsFile; readonly format?: OutputsFormat }
): string => {
  const ordered = { cluster: file.cluster, volumes: file.volumes }
  return format === "json" ? `${JSON.stringify(ordered, null, 2)}\n` : stringify(ordered)
}

export const stringifyOutputsYaml = (file: OutputsFile): string => stringifyOutputs({ file })

export const emptyOutputs = (tag: ClusterTag): OutputsFile => ({ cluster: tag, volumes: [] })

// kumulo: missing file reads as "no volumes recorded yet", not an error —
// first `ensureVolume` on a fresh cluster always starts from an empty file.
// The configured format's path is tried first, then the other extension, so
// switching `outputs.format` picks up the previously written file.
export const readOutputs = (
  { dir, format = "yaml", tag }: { readonly dir: string; readonly tag: ClusterTag; readonly format?: OutputsFormat }
): Effect.Effect<OutputsFile, OutputsInvalid | PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const other: OutputsFormat = format === "yaml" ? "json" : "yaml"
    for (const candidate of [format, other]) {
      const path = outputsPath({ dir, tag, format: candidate })
      if (yield* fs.exists(path)) return yield* parseOutputsYaml(yield* fs.readFileString(path))
    }
    return emptyOutputs(tag)
  })

export const writeOutputs = (
  { dir, file, format = "yaml" }: { readonly dir: string; readonly file: OutputsFile; readonly format?: OutputsFormat }
): Effect.Effect<void, PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    yield* fs.writeFileString(outputsPath({ dir, tag: file.cluster, format }), stringifyOutputs({ file, format }))
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
