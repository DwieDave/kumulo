import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { layerNoop } from "effect/FileSystem"
import { emptyOutputs, outputsPath, parseOutputsYaml, readOutputs, stringifyOutputsYaml, toOutputsBucket, writeOutputs } from "../src/outputs.ts"

const _text = (maxLength: number) =>
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maxLength), Schema.isPattern(/\S/))

const outputsBucketArb = Schema.Struct({
  name: _text(20),
  region: _text(10),
  versioning: Schema.Boolean,
  encryption: Schema.Boolean,
  retain: Schema.Boolean
})

const outputsFileArb = Schema.Struct({
  cluster: _text(20),
  buckets: Schema.Array(outputsBucketArb).check(Schema.isMaxLength(5))
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

describe("toOutputsBucket", () => {
  it("carries a BucketSpec's fields through unchanged", () => {
    const spec = { name: "staging-eu-backups", region: "DE1", versioning: false, encryption: true, retain: true }
    expect(toOutputsBucket(spec)).toEqual(spec)
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

      const file = { cluster: "prod", buckets: [{ name: "staging-eu-backups", region: "DE1", versioning: false, encryption: false, retain: true }] }
      yield* writeOutputs({ dir: "/out", file }).pipe(Effect.provide(fs))
      const roundTripped = yield* readOutputs({ dir: "/out", tag: "prod" }).pipe(Effect.provide(fs))
      expect(roundTripped).toEqual(file)
      expect(store.has(outputsPath({ dir: "/out", tag: "prod" }))).toBe(true)
    }))
})
