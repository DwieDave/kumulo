import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { stringifyConfigYaml } from "@kumulo/core"
import { parseConfigYaml } from "../../src/cluster-config.ts"
import { decodeConfig } from "../../src/cluster-config.ts"
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
