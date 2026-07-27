import { describe, expect, it } from "@effect/vitest"
import { AuthenticationFailed, ResponseDecodeError } from "@kumulo/core"
import { Effect } from "effect"
import { FastCheck as fc } from "effect/testing"
import { decodeVolumeSingle, decodeVolumesList, nextMarker } from "../src/schemas.ts"

describe("decodeVolumesList / decodeVolumeSingle", () => {
  it.effect("decodeVolumesList fails when the envelope is malformed", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(decodeVolumesList({ notVolumes: [] }))
      expect(failure).toBeInstanceOf(ResponseDecodeError)
      // A malformed body is a decode failure, never a credential problem.
      expect(failure).not.toBeInstanceOf(AuthenticationFailed)
    }))

  it.effect("decodeVolumesList tolerates volumes missing metadata/name", () =>
    Effect.gen(function*() {
      const result = yield* decodeVolumesList({ volumes: [{ id: "vol-1" }] })
      expect(result.volumes).toEqual([{ id: "vol-1" }])
    }))

  it.effect("decodeVolumesList rejects a volume without an id", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(decodeVolumesList({ volumes: [{ name: "a" }] }))
      expect(failure).toBeInstanceOf(ResponseDecodeError)
    }))

  it.effect("decodeVolumeSingle fails when the wrapper is malformed", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(decodeVolumeSingle({ notVolume: { id: "vol-1" } }))
      expect(failure).toBeInstanceOf(ResponseDecodeError)
      expect(failure).not.toBeInstanceOf(AuthenticationFailed)
    }))

  it("nextMarker reads the marker query param of the rel:next link", () => {
    expect(nextMarker({
      volumes: [{ id: "vol-1" }],
      volumes_links: [{ rel: "next", href: "https://cinder/v3/volumes/detail?limit=2&marker=vol-1" }]
    })).toBe("vol-1")
  })

  it("nextMarker is undefined without a rel:next link", () => {
    expect(nextMarker({ volumes: [{ id: "vol-1" }] })).toBeUndefined()
  })

  // Property: an arbitrary body either fails to decode or yields a record
  // with a real string id — never a `VolumeInfo{id:""}` placeholder.
  it.prop("a malformed single-volume body never decodes successfully", [fc.anything()], ([body]) => {
    const decoded = Effect.runSync(Effect.result(decodeVolumeSingle(body)))
    return decoded._tag === "Failure" || decoded.success.id.length > 0
  })

  it.prop("a malformed list body never yields id-less records", [fc.anything()], ([body]) => {
    const decoded = Effect.runSync(Effect.result(decodeVolumesList(body)))
    return decoded._tag === "Failure" || decoded.success.volumes.every((record) => record.id.length > 0)
  })
})
