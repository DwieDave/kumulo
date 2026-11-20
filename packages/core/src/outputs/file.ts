import { Data, Effect, Schema } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import { parse, stringify } from "yaml"
import type { OutputsFormat } from "../config/schema.ts"
import type { ClusterTag } from "../domain/types.ts"

export class OutputsInvalid extends Data.TaggedError("OutputsInvalid")<{
  readonly message: string
}> {}

export interface OutputsLocation {
  readonly dir: string
  readonly tag: ClusterTag
  readonly format?: OutputsFormat | undefined
}

export interface OutputsFileOptions<File> {
  readonly schema: Schema.Codec<File, unknown>
  // file stem between the cluster tag and the format, e.g. "buckets" gives <tag>.buckets.yaml
  readonly suffix: string
  readonly empty: (tag: ClusterTag) => File
  // fixes key order (and drops absent optional keys) before serialising
  readonly order?: ((file: File) => object) | undefined
  readonly clusterOf: (file: File) => ClusterTag
}

const _tmpName = (path: string): string => `${path}.tmp-${process.pid}-${Date.now()}`

export const makeOutputsFile = <File>(options: OutputsFileOptions<File>) => {
  const path = ({ dir, format = "yaml", tag }: OutputsLocation): string =>
    `${dir.endsWith("/") ? dir.slice(0, -1) : dir}/${tag}.${options.suffix}.${format}`

  const decode = (input: Schema.Json): Effect.Effect<File, OutputsInvalid> =>
    Schema.decodeUnknownEffect(options.schema)(input).pipe(
      Effect.mapError((cause) => new OutputsInvalid({ message: String(cause) }))
    )

  const parseYaml = (text: string): Effect.Effect<File, OutputsInvalid> =>
    Effect.try({ try: () => parse(text), catch: (cause) => new OutputsInvalid({ message: String(cause) }) }).pipe(
      Effect.flatMap(decode)
    )

  const stringifyFile = ({ file, format = "yaml" }: { readonly file: File; readonly format?: OutputsFormat | undefined }): string => {
    const ordered = options.order ? options.order(file) : file

    return format === "json" ? `${JSON.stringify(ordered, null, 2)}\n` : stringify(ordered)
  }

  // Missing file reads as empty, not an error; the other format is a fallback.
  const read = (
    { dir, format = "yaml", tag }: OutputsLocation
  ): Effect.Effect<File, OutputsInvalid | PlatformError, FileSystem> =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const other: OutputsFormat = format === "yaml" ? "json" : "yaml"

      for (const candidate of [format, other]) {
        const candidatePath = path({ dir, tag, format: candidate })

        if (yield* fs.exists(candidatePath)) return yield* parseYaml(yield* fs.readFileString(candidatePath))
      }

      return options.empty(tag)
    })

  // temp file + rename so a crash never leaves a half-written outputs file
  const write = (
    { dir, file, format = "yaml" }: { readonly dir: string; readonly file: File; readonly format?: OutputsFormat | undefined }
  ): Effect.Effect<void, PlatformError, FileSystem> =>
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const target = path({ dir, tag: options.clusterOf(file), format })
      const tmp = _tmpName(target)

      yield* fs.writeFileString(tmp, stringifyFile({ file, format }), { mode: 0o600 })
      yield* fs.rename(tmp, target).pipe(Effect.tapError(() => Effect.ignore(fs.remove(tmp))))
    })

  return { path, decode, parseYaml, stringify: stringifyFile, read, write, empty: options.empty }
}
