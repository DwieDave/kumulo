import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { CONFIG_HASH_KEY } from "@kumulo/core"
import { mksPoolHash } from "../../src/distro/nodepool-diff.ts"
import { makeMksClient } from "../../src/client/mks.ts"
import { deleteCluster } from "../../src/distro/delete.ts"
import { ensureCluster } from "../../src/distro/ensure-cluster.ts"
import { ensureNodePools } from "../../src/distro/ensure-nodepools.ts"
import { fetchKubeconfig } from "../../src/distro/kubeconfig.ts"
import { upgrade } from "../../src/distro/upgrade.ts"
import type { MksDriverConfig, MksWorkerPoolConfig } from "../../src/distro/types.ts"
import { makeFakeMksServer } from "./fake-mks-server.ts"

const _config: MksDriverConfig = {
  serviceName: "service-1",
  name: "prod-eu",
  region: "GRA5",
  version: "1.31",
  worker_pools: []
}

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

it.effect("full lifecycle: create → poll ready → converge pools → kubeconfig → upgrade → delete", () =>
  Effect.gen(function*() {
    // ponytail: `readyAfterPolls: 0` — `ensureCluster`'s poll loop itself is
    // a thin reimplementation of core's already-unit-tested `pollUntil`
    // (see errors.ts/status.ts comments); this test exercises the
    // create/converge/kubeconfig/upgrade/delete lifecycle, not real-time
    // polling cadence, so it shouldn't burn wall-clock seconds waiting on
    // the (production) 3-second poll interval.
    const server = makeFakeMksServer({ readyAfterPolls: 0 })
    const mks = makeMksClient(server.httpClient)

    const info = yield* ensureCluster({ mks, config: _config })
    assert.strictEqual(info.status, "READY")
    const ref = { serviceName: _config.serviceName, kubeId: info.id }

    // create a pool, then converge again with a scaled-up desired count —
    // proves update (not a spurious replace) for a mutable-only change.
    yield* ensureNodePools({ mks, ref, pools: [_pool()] })
    const created = [...(server.pools.get(info.id)?.values() ?? [])][0]
    assert.strictEqual(created?.desiredNodes, 3)
    // the drift stamp must actually reach the API (and round-trip back) —
    // without it every re-plan reads as "no stamped hash" and silently NoOps.
    assert.strictEqual(created?.template?.metadata?.annotations?.[CONFIG_HASH_KEY], mksPoolHash(_pool()))

    yield* ensureNodePools({ mks, ref, pools: [_pool({ desiredNodes: 5 })] })
    const poolsAfterUpdate = [...(server.pools.get(info.id)?.values() ?? [])]
    assert.strictEqual(poolsAfterUpdate.length, 1)
    assert.strictEqual(poolsAfterUpdate[0]?.desiredNodes, 5)

    // flavor change is immutable → replace (delete+recreate), not update —
    // and only once the operator confirmed that pool by name.
    yield* ensureNodePools({ mks, ref, pools: [_pool({ flavor: "b2-15", desiredNodes: 5 })] })
    assert.strictEqual([...(server.pools.get(info.id)?.values() ?? [])][0]?.flavor, "b2-7")

    yield* ensureNodePools({ mks, ref, pools: [_pool({ flavor: "b2-15", desiredNodes: 5 })], replace: new Set(["workers"]) })
    const poolsAfterReplace = [...(server.pools.get(info.id)?.values() ?? [])]
    assert.strictEqual(poolsAfterReplace.length, 1)
    assert.strictEqual(poolsAfterReplace[0]?.flavor, "b2-15")

    // dropping the pool from desired converges to zero pools.
    yield* ensureNodePools({ mks, ref, pools: [] })
    assert.strictEqual(server.pools.get(info.id)?.size, 0)

    const kubeconfig = yield* fetchKubeconfig({ mks, ref })
    assert.match(kubeconfig.content, /kind: Config/)

    yield* upgrade({ mks, ref, strategy: "NEXT_MINOR" })

    yield* deleteCluster({ mks, ref })
    assert.strictEqual(server.clusters.has(info.id), false)
  }))

it.effect("ensureCluster is idempotent: re-running finds the existing cluster by name", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer({ readyAfterPolls: 0 })
    const mks = makeMksClient(server.httpClient)

    const first = yield* ensureCluster({ mks, config: _config })
    const second = yield* ensureCluster({ mks, config: _config })

    assert.strictEqual(first.id, second.id)
    assert.strictEqual(server.clusters.size, 1)
  }))
