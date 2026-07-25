import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { Effect } from "effect"
import { decodeConfig } from "../../src/config/decode.ts"
import { validConfig } from "./fixtures.ts"

const withOvhBucket = {
  ...validConfig,
  object_storage: {
    module: "ovh" as const,
    buckets: [
      { name: "staging-eu-backups", region: "DE1", versioning: false, encryption: false, retain: true }
    ]
  },
  secrets: {
    sink: "sops" as const,
    dir: ".",
    sops: { age_recipient: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqql4pcnf" }
  }
}

const withNoObjectStorage = {
  ...validConfig,
  object_storage: { module: "none" as const },
  secrets: { sink: "none" as const }
}

const _pathsOf = (issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>) =>
  issues.map((issue) => issue.path.join("."))

describe("ClusterConfig — object_storage + secrets", () => {
  it.effect("decodes a full object_storage + sops secrets section", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeConfig(withOvhBucket)
      expect(decoded.object_storage.module).toBe("ovh")
      expect(decoded.object_storage.module === "ovh" && decoded.object_storage.buckets[0]?.name).toBe(
        "staging-eu-backups"
      )
      expect(decoded.secrets.sink).toBe("sops")
      expect(decoded.secrets.sink === "sops" && decoded.secrets.sops.age_recipient).toBe(
        withOvhBucket.secrets.sops.age_recipient
      )
    }))

  it.effect("decodes the none variants: no buckets key, no secrets dir/sops", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeConfig(withNoObjectStorage)
      expect(decoded.object_storage).toEqual({ module: "none" })
      expect(decoded.secrets).toEqual({ sink: "none" })
    }))

  it.effect("rejects a config missing the object_storage section", () =>
    Effect.gen(function* () {
      const { object_storage: _dropped, ...rest } = withNoObjectStorage
      const failure = yield* Effect.flip(decodeConfig(rest))
      expect(failure._tag).toBe("ConfigInvalid")
      expect(_pathsOf(failure.issues).some((path) => path.startsWith("object_storage"))).toBe(true)
    }))

  it.effect("rejects a config missing the secrets section", () =>
    Effect.gen(function* () {
      const { secrets: _dropped, ...rest } = withNoObjectStorage
      const failure = yield* Effect.flip(decodeConfig(rest))
      expect(failure._tag).toBe("ConfigInvalid")
      expect(_pathsOf(failure.issues).some((path) => path.startsWith("secrets"))).toBe(true)
    }))

  const badBucketNames = fc.constantFrom(
    "Staging-EU-Backups",
    "ab",
    "a".repeat(64),
    "-abcde",
    "abcde-"
  )

  it.prop(
    "rejects malformed S3 bucket names with a pathed issue",
    [badBucketNames],
    ([badName]) =>
      Effect.runSync(
        Effect.gen(function* () {
          const candidate = {
            ...withOvhBucket,
            object_storage: {
              ...withOvhBucket.object_storage,
              buckets: [{ ...withOvhBucket.object_storage.buckets[0], name: badName }]
            }
          }
          const failure = yield* Effect.flip(decodeConfig(candidate))
          return (
            failure._tag === "ConfigInvalid" &&
            _pathsOf(failure.issues).some((path) => path === "object_storage.buckets.0.name")
          )
        })
      )
  )

  // The none variant has no buckets field at all, so a stray array is dropped
  // rather than rejected — nothing downstream can read it.
  it.effect("drops a buckets array supplied under module: none", () =>
    Effect.gen(function* () {
      const candidate = {
        ...withOvhBucket,
        object_storage: { ...withOvhBucket.object_storage, module: "none" as const }
      }
      const decoded = yield* decodeConfig(candidate)
      expect(decoded.object_storage).toEqual({ module: "none" })
    }))

  it.effect("rejects module: ovh with secrets.sink: none", () =>
    Effect.gen(function* () {
      const candidate = {
        ...withOvhBucket,
        secrets: { sink: "none" as const }
      }
      const failure = yield* Effect.flip(decodeConfig(candidate))
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.effect("rejects secrets.sink: sops without a sops key", () =>
    Effect.gen(function* () {
      const candidate = {
        ...withOvhBucket,
        secrets: { sink: "sops" as const, dir: "." }
      }
      const failure = yield* Effect.flip(decodeConfig(candidate))
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.effect("rejects an age_recipient not starting with age1", () =>
    Effect.gen(function* () {
      const candidate = {
        ...withOvhBucket,
        secrets: {
          sink: "sops" as const,
          dir: ".",
          sops: { age_recipient: "notanagekey" }
        }
      }
      const failure = yield* Effect.flip(decodeConfig(candidate))
      expect(failure._tag).toBe("ConfigInvalid")
      expect(_pathsOf(failure.issues).some((path) => path === "secrets.sops.age_recipient")).toBe(true)
    }))
})
