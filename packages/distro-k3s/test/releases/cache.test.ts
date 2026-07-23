import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { makeReleaseCache } from "../../src/releases/cache.ts"

describe("makeReleaseCache", () => {
  it.effect("lists versions from the vendored fixture", () =>
    Effect.gen(function*() {
      const cache = yield* makeReleaseCache()
      const versions = yield* cache.list
      expect(versions.length).toBeGreaterThan(0)
    }))

  it.effect("validates a known version", () =>
    Effect.gen(function*() {
      const cache = yield* makeReleaseCache()
      const versions = yield* cache.list
      const resolved = yield* cache.validateVersion(versions[0] ?? "")
      expect(resolved.value).toBe(versions[0])
    }))

  it.effect("rejects an unknown version", () =>
    Effect.gen(function*() {
      const cache = yield* makeReleaseCache()
      const result = yield* cache.validateVersion("v0.0.0+bogus").pipe(Effect.flip)
      expect(result._tag).toBe("ConfigInvalid")
    }))

  it.effect("re-reads the source only after the TTL expires", () =>
    Effect.gen(function*() {
      let calls = 0
      let now = 0
      const cache = yield* makeReleaseCache({
        source: () => {
          calls += 1
          return ["v1.0.0"]
        },
        ttlMs: 100,
        now: () => now
      })
      yield* cache.list
      yield* cache.list
      expect(calls).toBe(1)
      now = 200
      yield* cache.list
      expect(calls).toBe(2)
    }))
})
