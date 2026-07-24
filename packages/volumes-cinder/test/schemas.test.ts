import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { decodeVolumeSingle, decodeVolumesList } from "../src/schemas.ts"

describe("decodeVolumesList / decodeVolumeSingle", () => {
  it.effect("decodeVolumesList falls back to an empty list when the envelope is malformed", () =>
    Effect.gen(function*() {
      const result = yield* decodeVolumesList({ notVolumes: [] })
      expect(result).toEqual([])
    }))

  it.effect("decodeVolumesList tolerates volumes missing metadata/name", () =>
    Effect.gen(function*() {
      const result = yield* decodeVolumesList({ volumes: [{ id: "vol-1" }] })
      expect(result).toEqual([{ id: "vol-1" }])
    }))

  it.effect("decodeVolumeSingle falls back to an empty record when the wrapper is malformed", () =>
    Effect.gen(function*() {
      const result = yield* decodeVolumeSingle({ notVolume: { id: "vol-1" } })
      expect(result).toEqual({})
    }))
})
