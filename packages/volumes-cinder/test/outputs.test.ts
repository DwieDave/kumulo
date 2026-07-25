import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "effect/testing/FastCheck"
import { layerNoop } from "effect/FileSystem"
import {
  emptyOutputs,
  outputsPath,
  parseOutputsYaml,
  readOutputs,
  removeVolume,
  stringifyOutputsYaml,
  upsertVolume,
  writeOutputs
} from "../src/outputs.ts"

const outputsVolumeArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  id: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  retain: fc.boolean()
})

const outputsFileArb = fc.record({
  cluster: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  volumes: fc.array(outputsVolumeArb, { maxLength: 5 })
})

describe("outputs file YAML round-trip", () => {
  it.effect.prop(
    "stringify -> parse recovers the original file",
    { file: outputsFileArb },
    ({ file }) =>
      Effect.gen(function*() {
        const parsed = yield* parseOutputsYaml(stringifyOutputsYaml(file))
        expect(parsed).toEqual(file)
      })
  )
})

describe("upsertVolume / removeVolume", () => {
  it("update-by-name replaces, not appends", () => {
    const file = emptyOutputs("prod")
    const withOne = upsertVolume({ file, volume: { name: "a", id: "1", retain: true } })
    const updated = upsertVolume({ file: withOne, volume: { name: "a", id: "2", retain: false } })
    expect(updated.volumes).toEqual([{ name: "a", id: "2", retain: false }])
  })

  it("removeVolume drops only the matching name", () => {
    const file = { cluster: "prod", volumes: [{ name: "a", id: "1", retain: true }, { name: "b", id: "2", retain: true }] }
    expect(removeVolume({ file, name: "a" }).volumes).toEqual([{ name: "b", id: "2", retain: true }])
  })
})

describe("readOutputs / writeOutputs (in-memory FileSystem)", () => {
  it.effect("missing file reads as empty outputs for that cluster tag", () =>
    Effect.gen(function*() {
      const file = yield* readOutputs({ dir: "/out", tag: "prod" })
      expect(file).toEqual(emptyOutputs("prod"))
    }).pipe(Effect.provide(layerNoop({ exists: () => Effect.succeed(false) }))))

  it.effect("write then read recovers the same outputs file", () =>
    Effect.gen(function*() {
      const store = new Map<string, string>()
      const fs = layerNoop({
        exists: (path) => Effect.succeed(store.has(path)),
        writeFileString: (path, data) => Effect.sync(() => void store.set(path, data)),
        readFileString: (path) => Effect.succeed(store.get(path) ?? "")
      })
      const file = { cluster: "prod", volumes: [{ name: "postgres-data", id: "vol-1", retain: true }] }
      yield* writeOutputs({ dir: "/out", file }).pipe(Effect.provide(fs))
      const roundTripped = yield* readOutputs({ dir: "/out", tag: "prod" }).pipe(Effect.provide(fs))
      expect(roundTripped).toEqual(file)
      expect(store.has(outputsPath({ dir: "/out", tag: "prod" }))).toBe(true)
    }))

  it.effect("json format writes .outputs.json and round-trips", () =>
    Effect.gen(function*() {
      const store = new Map<string, string>()
      const fs = layerNoop({
        exists: (path) => Effect.succeed(store.has(path)),
        writeFileString: (path, data) => Effect.sync(() => void store.set(path, data)),
        readFileString: (path) => Effect.succeed(store.get(path) ?? "")
      })
      const file = { cluster: "prod", volumes: [{ name: "postgres-data", id: "vol-1", retain: true }] }
      yield* writeOutputs({ dir: "/out", file, format: "json" }).pipe(Effect.provide(fs))
      expect(store.has("/out/prod.outputs.json")).toBe(true)
      expect(JSON.parse(store.get("/out/prod.outputs.json") ?? "")).toEqual(file)
      const roundTripped = yield* readOutputs({ dir: "/out", tag: "prod", format: "json" }).pipe(Effect.provide(fs))
      expect(roundTripped).toEqual(file)
    }))

  it.effect("reading with json format falls back to an existing yaml file", () =>
    Effect.gen(function*() {
      const store = new Map<string, string>()
      const fs = layerNoop({
        exists: (path) => Effect.succeed(store.has(path)),
        writeFileString: (path, data) => Effect.sync(() => void store.set(path, data)),
        readFileString: (path) => Effect.succeed(store.get(path) ?? "")
      })
      const file = { cluster: "prod", volumes: [{ name: "a", id: "1", retain: false }] }
      yield* writeOutputs({ dir: "/out", file }).pipe(Effect.provide(fs))
      const read = yield* readOutputs({ dir: "/out", tag: "prod", format: "json" }).pipe(Effect.provide(fs))
      expect(read).toEqual(file)
    }))
})
