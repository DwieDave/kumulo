import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { filterAllowlist } from "../src/allowlist.ts"
import { syntheticSpec, syntheticSpecWithSchemas } from "./fixtures.ts"

describe("filterAllowlist", () => {
  it.effect("prunes component schemas unreachable from surviving operations", () =>
    Effect.gen(function* () {
      const filtered = yield* filterAllowlist({ spec: syntheticSpecWithSchemas, allowlist: ["getWidget"] })
      expect(Object.keys(filtered.components?.schemas ?? {}).toSorted()).toEqual(["Widget", "WidgetOwner"])
    }))


  it.effect("keeps only allowlisted operations", () =>
    Effect.gen(function* () {
      const filtered = yield* filterAllowlist({ spec: syntheticSpec, allowlist: ["listWidgets"] })
      expect(Object.keys(filtered.paths)).toEqual(["/widgets"])
      expect(Object.keys(filtered.paths["/widgets"] ?? {})).toEqual(["get"])
    }))

  it.effect("drops a path entirely once all its operations are filtered out", () =>
    Effect.gen(function* () {
      const filtered = yield* filterAllowlist({ spec: syntheticSpec, allowlist: ["listWidgets", "createWidget"] })
      expect(Object.keys(filtered.paths)).toEqual(["/widgets"])
    }))

  it.effect("fails loudly when an allowlist entry matches no operation", () =>
    Effect.gen(function* () {
      const result = yield* Effect.flip(
        filterAllowlist({ spec: syntheticSpec, allowlist: ["listWidgets", "notARealOperation"] })
      )
      expect(result._tag).toEqual("AllowlistOperationNotFound")
      expect(result.operationIds).toEqual(["notARealOperation"])
    }))
})
