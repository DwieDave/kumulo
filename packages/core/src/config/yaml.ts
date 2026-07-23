import { Effect } from "effect"
import { parse, stringify } from "yaml"
import { ConfigInvalid } from "../errors/tagged.ts"
import { decodeConfig } from "./decode.ts"
import type { ClusterConfig } from "./schema.ts"

export const parseConfigYaml = (text: string): Effect.Effect<ClusterConfig, ConfigInvalid> =>
  Effect.try({
    try: () => parse(text),
    catch: (cause) => new ConfigInvalid({ issues: [{ path: [], message: String(cause) }] })
  }).pipe(Effect.flatMap(decodeConfig))

export const stringifyConfigYaml = (config: ClusterConfig): string => stringify(config)
