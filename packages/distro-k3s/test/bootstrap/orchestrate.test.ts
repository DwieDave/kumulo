import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import type { SshHost } from "../../src/ssh/port.ts"
import type { NonEmptyMasters } from "../../src/bootstrap/token.ts"
import { installMasters, installWorkers } from "../../src/bootstrap/orchestrate.ts"

const _hosts = (n: number): ReadonlyArray<SshHost> =>
  Array.from({ length: n }, (_, i) => ({ ip: `10.0.0.${i + 1}`, port: 22 }))

const threeMasters: NonEmptyMasters = [
  { ip: "10.0.0.1", port: 22 },
  { ip: "10.0.0.2", port: 22 },
  { ip: "10.0.0.3", port: 22 }
]

describe("installMasters", () => {
  it.effect("installs master 1 before any other master starts", () =>
    Effect.gen(function*() {
      const order: Array<string> = []
      yield* installMasters({
        masters: threeMasters,
        installOne: (host, isFirst) => Effect.sync(() => order.push(`${host.ip}:${isFirst}`))
      })
      expect(order[0]).toBe("10.0.0.1:true")
      expect(order).toHaveLength(3)
      expect(new Set(order.slice(1))).toEqual(new Set(["10.0.0.2:false", "10.0.0.3:false"]))
    }))

  it.effect("installs a single master as first-master with no parallel fan-out", () =>
    Effect.gen(function*() {
      const order: Array<string> = []
      yield* installMasters({
        masters: [{ ip: "10.0.0.1", port: 22 }],
        installOne: (host, isFirst) => Effect.sync(() => order.push(`${host.ip}:${isFirst}`))
      })
      expect(order).toEqual(["10.0.0.1:true"])
    }))
})

describe("installWorkers", () => {
  it.effect("installs every worker exactly once", () =>
    Effect.gen(function*() {
      const installed: Array<string> = []
      yield* installWorkers({
        workers: _hosts(5),
        installOne: (host) => Effect.sync(() => installed.push(host.ip)),
        concurrency: 2
      })
      expect(installed).toHaveLength(5)
      expect(new Set(installed)).toEqual(new Set(_hosts(5).map((h) => h.ip)))
    }))
})
