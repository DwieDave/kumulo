import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import { parse, stringify } from "yaml"
import type { ClusterTag, OutputsFormat } from "@kumulo/core"

export const OutputsBucket = Schema.Struct({
  id: Schema.Number,
  name: Schema.NonEmptyString,
  region: Schema.NonEmptyString,
  tier: Schema.Literals(["standard", "edge"]),
  retain: Schema.Boolean
})

export type OutputsBucket = Schema.Schema.Type<typeof OutputsBucket>

export const OutputsFile = Schema.Struct({
  cluster: Schema.NonEmptyString,
  buckets: Schema.Array(OutputsBucket)
})

export type OutputsFile = Schema.Schema.Type<typeof OutputsFile>

export class OutputsInvalid extends Data.TaggedError("OutputsInvalid")<{
  readonly message: string
}> {}

interface OutputsLocation {
  readonly dir: string
  readonly tag: ClusterTag
  readonly format?: OutputsFormat
}

export const outputsPath = ({ dir, format = "yaml", tag }: OutputsLocation): string =>
  `${dir.endsWith("/") ? dir.slice(0, -1) : dir}/${tag}.buckets.${format}`

export const decodeOutputs = (input: Schema.Json): Effect.Effect<OutputsFile, OutputsInvalid> =>
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
  const ordered = { cluster: file.cluster, buckets: file.buckets }

  return format === "json" ? `${JSON.stringify(ordered, null, 2)}\n` : stringify(ordered)
}

export const emptyOutputs = (tag: ClusterTag): OutputsFile => ({ cluster: tag, buckets: [] })

export const readOutputs = (
  { dir, format = "yaml", tag }: OutputsLocation
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
