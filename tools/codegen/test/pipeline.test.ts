import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, Exit } from "effect"
import { runPipeline } from "../src/pipeline.ts"
import { checkNoop } from "../src/regenCheck.ts"
import { syntheticSpec } from "./fixtures.ts"

describe("runPipeline", () => {
  it.effect("filters, patches, and generates end-to-end from a synthetic spec", () =>
    Effect.gen(function* () {
      const { source } = yield* runPipeline({
        spec: syntheticSpec,
        allowlist: ["listWidgets", "createWidget"],
        patches: [{ source: "rename.patch.json", patch: [{ op: "replace", path: "/info/title", value: "Widgets API" }] }],
        generate: { name: "Widgets", format: "httpclient" }
      })
      expect(source.length).toBeGreaterThan(0)
    }))

  it.effect("regenerating the same pipeline twice is byte-identical (regen-is-noop)", () =>
    Effect.gen(function* () {
      const input = {
        spec: syntheticSpec,
        allowlist: ["listWidgets"],
        patches: [],
        generate: { name: "Widgets", format: "httpclient" as const }
      }
      const first = yield* runPipeline(input)
      const second = yield* runPipeline(input)
      yield* checkNoop({ committedPath: "committed.ts", committed: first.source, regenerated: second.source })
    }))

  it.effect("surfaces the allowlist stage's error through the pipeline", () =>
    Effect.gen(function* () {
      const result = yield* Effect.flip(
        runPipeline({
          spec: syntheticSpec,
          allowlist: ["notReal"],
          patches: [],
          generate: { name: "Widgets", format: "httpclient" }
        })
      )
      expect(result._tag).toEqual("AllowlistOperationNotFound")
    }))

  it.effect("dies when a patch strips the document down to a non-OpenAPISpec shape", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        runPipeline({
          spec: syntheticSpec,
          allowlist: ["listWidgets"],
          patches: [{ source: "strip-paths.patch.json", patch: [{ op: "remove", path: "/paths" }] }],
          generate: { name: "Widgets", format: "httpclient" }
        })
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true)
      }
    }))
})
