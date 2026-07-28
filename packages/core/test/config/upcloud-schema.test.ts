import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { decodeConfig } from "../../src/config/decode.ts"
import { validUpcloudUksConfig } from "./fixtures.ts"

// T1.1 — Provider += "upcloud", DistroKind += "upcloud-uks", UksVersion (D7),
// UpcloudUksClusterConfig joined into the ClusterConfig union (R14, R15).
describe("UpcloudUksClusterConfig", () => {
  it.effect("decodes a minimal valid config", () =>
    Effect.gen(function*() {
      const decoded = yield* decodeConfig(validUpcloudUksConfig)
      expect(decoded.distro).toBe("upcloud-uks")
      expect(decoded.provider).toBe("upcloud")
    }))

  it.effect("rejects a X.Y.Z version — UKS is minor-only (D7)", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(decodeConfig({ ...validUpcloudUksConfig, version: "1.31.4" }))
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.effect("rejects volumes.module other than none", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(
        decodeConfig({ ...validUpcloudUksConfig, volumes: { module: "cinder", managed: [] } })
      )
      expect(failure._tag).toBe("ConfigInvalid")
    }))
})
