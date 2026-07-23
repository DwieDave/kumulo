import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { parseConfigYaml, stringifyConfigYaml } from "../../src/config/yaml.ts"
import { decodeConfig } from "../../src/config/decode.ts"
import { validConfig } from "./fixtures.ts"

describe("YAML config", () => {
  it.effect("parses valid YAML into a ClusterConfig", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeConfig(validConfig)
      const yaml = stringifyConfigYaml(decoded)
      const reparsed = yield* parseConfigYaml(yaml)
      expect(reparsed).toEqual(decoded)
    }))

  it.effect("surfaces a pathed ConfigInvalid for malformed YAML content", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(parseConfigYaml("name: [unclosed"))
      expect(failure._tag).toBe("ConfigInvalid")
    }))
})
