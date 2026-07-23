import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Layer, Ref } from "effect"
import { applyServers } from "../../src/reconcile/apply.ts"
import { CloudProvider } from "../../src/ports/cloud-provider.ts"
import { FakeCloudProviderLive } from "../fakes/cloud-provider.ts"
import type { ServerSpec } from "../../src/domain/types.ts"

// kumulo: test-local decorator over the shared fake — blocks on `Effect.never`
// (no `Clock`/wall-time dependency, so it's unaffected by `it.effect`'s
// virtual `TestClock`) the first time a 2nd distinct server would be
// created. That gives this one test a deterministic "genuinely mid-apply"
// window to interrupt into, without changing the shared fake's behavior for
// every other test that reuses it.
const _blockOnSecondServerLive: Layer.Layer<CloudProvider> = Layer.effect(
  CloudProvider,
  Effect.gen(function*() {
    const base = yield* CloudProvider
    const count = yield* Ref.make(0)
    return {
      ...base,
      ensureServer: (spec: ServerSpec) =>
        Ref.updateAndGet(count, (n) => n + 1).pipe(
          Effect.flatMap((n) => (n === 2 ? Effect.never : base.ensureServer(spec)))
        )
    }
  })
).pipe(Layer.provide(FakeCloudProviderLive))

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
      // `_blockOnSecondServerLive` blocks on `Effect.never` the first time a
      // 2nd distinct server would be created — yielding gives the forked
      // fiber a chance to run into that block, guaranteeing the interrupt
      // below lands genuinely mid-apply (1 server committed, not 0 and not
      // all 4), with no wall-clock race.
      yield* Effect.yieldNow
      yield* Effect.yieldNow
      yield* Fiber.interrupt(fiber)

      const partial = yield* cloudProvider.listClusterResources("demo")
      expect(partial.servers.length).toBeGreaterThan(0)
      expect(partial.servers.length).toBeLessThan(specs.length)
      const names = new Set(partial.servers.map((server) => server.name))
      expect(names.size).toBe(partial.servers.length)

      yield* applyServers({ specs, concurrency: 2 })
      const converged = yield* cloudProvider.listClusterResources("demo")
      expect(converged.servers).toHaveLength(specs.length)
      expect(new Set(converged.servers.map((server) => server.name)).size).toBe(specs.length)
    }).pipe(Effect.provide(_blockOnSecondServerLive)))
})
