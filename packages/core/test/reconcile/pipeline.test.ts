import { describe, expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { runPhases } from "../../src/reconcile/pipeline.ts"

describe("runPhases", () => {
  it.effect("runs phases in dependency order, ignoring unsupplied phases", () =>
    Effect.gen(function*() {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const record = (name: string) => Ref.update(log, (entries) => [...entries, name])

      yield* runPhases({
        order: ["Network", "Security", "LB", "Nodes"],
        phases: [
          { name: "Nodes", run: record("Nodes") },
          { name: "Network", run: record("Network") },
          { name: "LB", run: record("LB") }
        ]
      })

      expect(yield* Ref.get(log)).toEqual(["Network", "LB", "Nodes"])
    }))

  it.effect("short-circuits on the first phase failure", () =>
    Effect.gen(function*() {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const record = (name: string) => Ref.update(log, (entries) => [...entries, name])

      const result = yield* runPhases({
        order: ["Network", "Security"],
        phases: [
          { name: "Network", run: record("Network") },
          { name: "Security", run: Effect.fail("boom" as const) }
        ]
      }).pipe(Effect.flip)

      expect(result).toBe("boom")
      expect(yield* Ref.get(log)).toEqual(["Network"])
    }))
})
