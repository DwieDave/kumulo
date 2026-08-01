import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { decodeConfig } from "../../src/cluster-config.ts"
import { validUpcloudUksConfig } from "./fixtures.ts"

describe("UpcloudUksClusterConfig", () => {
  it.effect("decodes a minimal valid config", () =>
    Effect.gen(function*() {
      const decoded = yield* decodeConfig(validUpcloudUksConfig)
      expect(decoded.distro).toBe("upcloud-uks")
      expect(decoded.provider).toBe("upcloud")
    }))

  it.effect("rejects a X.Y.Z version — UKS is minor-only", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(decodeConfig({ ...validUpcloudUksConfig, version: "1.31.4" }))
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.effect("rejects volumes.module cinder/hcloud", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(
        decodeConfig({ ...validUpcloudUksConfig, volumes: { module: "cinder", managed: [] } })
      )
      expect(failure._tag).toBe("ConfigInvalid")
    }))
})

describe("upcloud volumes and object storage modules", () => {
  const upcloudVolume = {
    name: "data",
    size_gb: 50,
    type: "maxiops",
    retain: true
  }
  const sops = { sink: "sops", dir: ".", sops: { age_recipient: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" } } as const

  it.effect("decodes volumes.module upcloud with a maxiops managed volume", () =>
    Effect.gen(function*() {
      const decoded = yield* decodeConfig({
        ...validUpcloudUksConfig,
        volumes: { module: "upcloud", managed: [upcloudVolume] }
      })
      expect(decoded.volumes.module).toBe("upcloud")
    }))

  it.effect("rejects an unknown volume tier — the enum is closed", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(decodeConfig({
        ...validUpcloudUksConfig,
        volumes: { module: "upcloud", managed: [{ ...upcloudVolume, type: "ssd" }] }
      }))
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.effect("decodes object_storage.module upcloud with region, buckets and a sops sink", () =>
    Effect.gen(function*() {
      const decoded = yield* decodeConfig({
        ...validUpcloudUksConfig,
        object_storage: {
          module: "upcloud",
          region: "europe-1",
          buckets: [{ name: "artifacts", retain: false }]
        },
        secrets: sops
      })
      expect(decoded.object_storage.module).toBe("upcloud")
    }))

  it.effect("rejects upcloud object storage with secrets.sink none", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(decodeConfig({
        ...validUpcloudUksConfig,
        object_storage: {
          module: "upcloud",
          region: "europe-1",
          buckets: [{ name: "artifacts", retain: false }]
        }
      }))
      expect(failure._tag).toBe("ConfigInvalid")
    }))
})
