import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { makeMksClient } from "../../src/client/mks.ts"
import { ensureCluster } from "../../src/distro/ensure-cluster.ts"
import { ensureNodePools, listNodePools } from "../../src/distro/ensure-nodepools.ts"
import { diffNodePools, mksPoolHash } from "../../src/distro/nodepool-diff.ts"
import type { MksDriverConfig, MksWorkerPoolConfig } from "../../src/distro/types.ts"
import { makeFakeMksServer } from "./fake-mks-server.ts"

const _config: MksDriverConfig = { serviceName: "service-1", name: "prod-eu", region: "GRA5", version: "1.31", worker_pools: [] }

const _pool = (overrides: Partial<MksWorkerPoolConfig> = {}): MksWorkerPoolConfig => ({
  name: "workers",
  flavor: "b2-7",
  desiredNodes: 3,
  minNodes: 1,
  maxNodes: 5,
  autoscale: true,
  antiAffinity: true,
  monthlyBilled: false,
  ...overrides
})

const _setup = Effect.fn(function*() {
  const server = makeFakeMksServer({ readyAfterPolls: 0 })
  const mks = makeMksClient(server.httpClient)
  const info = yield* ensureCluster({ mks, config: _config })
  return { server, mks, ref: { serviceName: _config.serviceName, kubeId: info.id } }
})

it.effect("a created pool is stamped with its config hash and reads it back", () =>
  Effect.gen(function*() {
    const { mks, ref } = yield* _setup()
    yield* ensureNodePools({ mks, ref, pools: [_pool()] })
    const [existing] = yield* listNodePools({ mks, ref })
    assert.strictEqual(existing?.configHash, mksPoolHash(_pool()))
    // scaling is a mutable change: same hash, so it never plans as a replace.
    assert.strictEqual(mksPoolHash(_pool({ desiredNodes: 9 })), existing?.configHash)
  }))

it.effect("a confirmed replace deletes then recreates the pool, re-stamped; re-diffing is then a no-op", () =>
  Effect.gen(function*() {
    const { mks, ref, server } = yield* _setup()
    yield* ensureNodePools({ mks, ref, pools: [_pool()] })
    const [before] = yield* listNodePools({ mks, ref })

    const desired = _pool({ flavor: "b2-15" })
    yield* ensureNodePools({ mks, ref, pools: [desired], replace: new Set(["workers"]) })

    const after = yield* listNodePools({ mks, ref })
    assert.strictEqual(after.length, 1)
    assert.strictEqual(server.pools.get(ref.kubeId)?.has(before?.id ?? ""), false, "old pool must be gone")
    assert.notStrictEqual(after[0]?.id, before?.id)
    assert.strictEqual(after[0]?.flavor, "b2-15")
    assert.strictEqual(after[0]?.configHash, mksPoolHash(desired))

    const rediff = diffNodePools({ desired: [desired], existing: after })
    assert.deepStrictEqual([rediff.toCreate, rediff.toReplace, rediff.toUpdate, rediff.toDelete], [[], [], [], []])
  }))

it.effect("a pool with no stamped hash is never replaced without confirmation", () =>
  Effect.gen(function*() {
    const { mks, ref, server } = yield* _setup()
    // A pre-existing production pool: created outside kumulo, so no stamp.
    server.pools.get(ref.kubeId)?.set("legacy", {
      id: "legacy",
      name: "workers",
      flavor: "b2-7",
      desiredNodes: 3,
      minNodes: 1,
      maxNodes: 5,
      autoscale: true,
      antiAffinity: true,
      monthlyBilled: false
    })
    yield* ensureNodePools({ mks, ref, pools: [_pool({ flavor: "b2-15" })] })
    const after = yield* listNodePools({ mks, ref })
    assert.deepStrictEqual(after.map((pool) => pool.id), ["legacy"])
    assert.strictEqual(after[0]?.flavor, "b2-7")
    assert.strictEqual(after[0]?.configHash, undefined)
  }))
