import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import { parse, stringify } from "yaml"
import type { ClusterTag, OutputsFormat } from "@kumulo/core"

export const OutputsVolume = Schema.Struct({
  name: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  retain: Schema.Boolean
})
export type OutputsVolume = Schema.Schema.Type<typeof OutputsVolume>

export const OutputsIngress = Schema.Struct({
  load_balancer_id: Schema.NonEmptyString,
  floating_ip: Schema.NonEmptyString
})
export type OutputsIngress = Schema.Schema.Type<typeof OutputsIngress>

export const OutputsFile = Schema.Struct({
  cluster: Schema.NonEmptyString,
  volumes: Schema.Array(OutputsVolume),
  ingress: Schema.optionalKey(OutputsIngress)
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

export const parseOutputsYaml = (text: string): Effect.Effect<OutputsFile, OutputsInvalid> =>
  Effect.try({ try: () => parse(text), catch: (cause) => new OutputsInvalid({ message: String(cause) }) }).pipe(
    Effect.flatMap(decodeOutputs)
  )

export const stringifyOutputs = (
  { file, format = "yaml" }: { readonly file: OutputsFile; readonly format?: OutputsFormat }
): string => {
  const ordered = {
    cluster: file.cluster,
    volumes: file.volumes,
    ...(file.ingress === undefined ? {} : { ingress: file.ingress })
  }
  return format === "json" ? `${JSON.stringify(ordered, null, 2)}\n` : stringify(ordered)
}

export const stringifyOutputsYaml = (file: OutputsFile): string => stringifyOutputs({ file })

export const emptyOutputs = (tag: ClusterTag): OutputsFile => ({ cluster: tag, volumes: [] })

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

export const upsertVolume = (
  { file, volume }: { readonly file: OutputsFile; readonly volume: OutputsVolume }
): OutputsFile => ({
  cluster: file.cluster,
  volumes: [...file.volumes.filter((existing: OutputsVolume) => existing.name !== volume.name), volume]
})

export const setIngress = (
  { file, ingress }: { readonly file: OutputsFile; readonly ingress: OutputsIngress }
): OutputsFile => ({ cluster: file.cluster, volumes: file.volumes, ingress })

export const removeVolume = ({ file, name }: { readonly file: OutputsFile; readonly name: string }): OutputsFile => ({
  cluster: file.cluster,
  volumes: file.volumes.filter((existing: OutputsVolume) => existing.name !== name)
})
