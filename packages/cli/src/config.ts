import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"
import type { PlatformError } from "effect/PlatformError"
import type { ClusterConfig, ConfigInvalid } from "@kumulo/core"
import { parseConfigYaml } from "@kumulo/core"

/** FR-10.1 — `--config` loads and validates the YAML config (FR-1.1). */
export const loadConfig = (
  path: string
): Effect.Effect<ClusterConfig, ConfigInvalid | PlatformError, FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const text = yield* fs.readFileString(path)
    return yield* parseConfigYaml(text)
  })
