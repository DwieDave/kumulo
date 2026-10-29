import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import { parse, stringify } from "yaml"
import type { ClusterTag, OutputsFormat } from "@kumulo/core"

export const CdnOutputsFile = Schema.Struct({
  cluster: Schema.NonEmptyString,
  pullZoneId: Schema.optional(Schema.Number),
  systemHostname: Schema.optional(Schema.String),
  shieldZoneId: Schema.optional(Schema.Number),
  rules: Schema.Record(Schema.String, Schema.Number),
  lists: Schema.Record(Schema.String, Schema.Number)
})

export type CdnOutputsFile = Schema.Schema.Type<typeof CdnOutputsFile>

export class CdnOutputsInvalid extends Data.TaggedError("CdnOutputsInvalid")<{
  readonly message: string
}> {}

interface OutputsLocation {
  readonly dir: string
  readonly tag: ClusterTag
  readonly format?: OutputsFormat
}

export const cdnOutputsPath = ({ dir, format = "yaml", tag }: OutputsLocation): string =>
  `${dir.endsWith("/") ? dir.slice(0, -1) : dir}/${tag}.cdn.${format}`

export const emptyCdnOutputs = (tag: ClusterTag): CdnOutputsFile => ({ cluster: tag, rules: {}, lists: {} })

export const decodeCdnOutputs = (input: Schema.Json): Effect.Effect<CdnOutputsFile, CdnOutputsInvalid> =>
  Schema.decodeUnknownEffect(CdnOutputsFile)(input).pipe(
    Effect.mapError((cause) => new CdnOutputsInvalid({ message: String(cause) }))
  )

export const parseCdnOutputsYaml = (text: string): Effect.Effect<CdnOutputsFile, CdnOutputsInvalid> =>
  Effect.try({ try: () => parse(text), catch: (cause) => new CdnOutputsInvalid({ message: String(cause) }) }).pipe(
    Effect.flatMap(decodeCdnOutputs)
  )

export const stringifyCdnOutputs = (
  { file, format = "yaml" }: { readonly file: CdnOutputsFile; readonly format?: OutputsFormat }
): string => {
  const ordered = {
    cluster: file.cluster,
    pullZoneId: file.pullZoneId,
    systemHostname: file.systemHostname,
    shieldZoneId: file.shieldZoneId,
    rules: file.rules,
    lists: file.lists
  }

  return format === "json" ? `${JSON.stringify(ordered, null, 2)}\n` : stringify(ordered)
}

export const readCdnOutputs = (
  { dir, format = "yaml", tag }: OutputsLocation
): Effect.Effect<CdnOutputsFile, CdnOutputsInvalid | PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const other: OutputsFormat = format === "yaml" ? "json" : "yaml"

    for (const candidate of [format, other]) {
      const path = cdnOutputsPath({ dir, tag, format: candidate })

      if (yield* fs.exists(path)) return yield* parseCdnOutputsYaml(yield* fs.readFileString(path))
    }

    return emptyCdnOutputs(tag)
  })

export const writeCdnOutputs = (
  { dir, file, format = "yaml" }: { readonly dir: string; readonly file: CdnOutputsFile; readonly format?: OutputsFormat }
): Effect.Effect<void, PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    yield* fs.writeFileString(cdnOutputsPath({ dir, tag: file.cluster, format }), stringifyCdnOutputs({ file, format }))
  })
