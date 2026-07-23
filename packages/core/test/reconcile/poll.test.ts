import { describe, expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { pollUntil } from "../../src/reconcile/poll.ts"

describe("pollUntil", () => {
  it.live("resolves once isDone is satisfied", () =>
    Effect.gen(function*() {
      const calls = yield* Ref.make(0)
      const status = yield* pollUntil({
        check: Ref.updateAndGet(calls, (n) => n + 1),
        isDone: (n: number) => n >= 3,
        interval: "1 millis",
        timeout: "1 second",
        kind: "server",
        ref: "kumulo-x-master-a-0"
      })
      expect(status).toBe(3)
    }))

  it.live("fails with ProvisioningTimeout carrying lastStatus when the deadline passes", () =>
    Effect.gen(function*() {
      const result = yield* pollUntil({
        check: Effect.succeed("BUILDING"),
        isDone: (status: string) => status === "ACTIVE",
        interval: "1 millis",
        timeout: "10 millis",
        kind: "server",
        ref: "kumulo-x-master-a-0"
      }).pipe(Effect.flip)

      expect(result._tag).toBe("ProvisioningTimeout")
      expect(result.kind).toBe("server")
      expect(result.ref).toBe("kumulo-x-master-a-0")
      expect(result.lastStatus).toBe("BUILDING")
    }))
})
