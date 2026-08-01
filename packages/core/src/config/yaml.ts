import { Effect } from "effect"
import type { Schema } from "effect"
import { parse, stringify } from "yaml"
import { ConfigInvalid } from "../errors/tagged.ts"
import { decodeConfigWith } from "./decode.ts"

export const parseConfigYamlWith = <S extends Schema.Top>(schema: S) => (text: string): Effect.Effect<S["Type"], ConfigInvalid, S["DecodingServices"]> =>
  Effect.try({
    try: () => parse(text),
    catch: (cause) => new ConfigInvalid({ issues: [{ path: [], message: String(cause) }] })
  }).pipe(Effect.flatMap(decodeConfigWith(schema)))

export const stringifyConfigYaml = (config: unknown): string => stringify(config)
