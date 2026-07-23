import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { applyServers } from "../../src/reconcile/apply.ts"
import { CloudProvider } from "../../src/ports/cloud-provider.ts"
import { FakeCloudProviderLive } from "../fakes/cloud-provider.ts"
import type { ServerSpec } from "../../src/domain/types.ts"

const specs: ReadonlyArray<ServerSpec> = [0, 1, 2, 3].map((index) => ({
  name: `kumulo-demo-master-a-${index}`,
  role: "master",
  flavor: "b2-7",
  image: "ubuntu-24.04",
  tag: "demo"
}))

describe("applyServers", () => {
  it.effect("re-running an idempotent apply converges without duplicating servers (FR-2.4)", () =>
    Effect.gen(function*() {
      const cloudProvider = yield* CloudProvider
      yield* applyServers({ specs, concurrency: 2 })
      yield* applyServers({ specs, concurrency: 2 })
      const inventory = yield* cloudProvider.listClusterResources("demo")
      expect(inventory.servers).toHaveLength(specs.length)
    }).pipe(Effect.provide(FakeCloudProviderLive)))

  it.effect("interrupting mid-apply leaves the store consistent, and a re-run still converges (NFR-6)", () =>
    Effect.gen(function*() {
      const cloudProvider = yield* CloudProvider
      const fiber = yield* Effect.forkChild(applyServers({ specs, concurrency: 1 }))
      yield* Effect.sleep("0 millis")
      yield* Fiber.interrupt(fiber)

      const partial = yield* cloudProvider.listClusterResources("demo")
      expect(partial.servers.length).toBeLessThanOrEqual(specs.length)
      const names = new Set(partial.servers.map((server) => server.name))
      expect(names.size).toBe(partial.servers.length)

      yield* applyServers({ specs, concurrency: 2 })
      const converged = yield* cloudProvider.listClusterResources("demo")
      expect(converged.servers).toHaveLength(specs.length)
      expect(new Set(converged.servers.map((server) => server.name)).size).toBe(specs.length)
    }).pipe(Effect.provide(FakeCloudProviderLive)))
})
