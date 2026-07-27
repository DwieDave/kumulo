import { Effect, Layer } from "effect"
import { assert, it } from "@effect/vitest"
import { dnsNoopLive, namesToReplace } from "@kumulo/core"
import type { ClusterConfig } from "@kumulo/core"
import { makeMksClient, mksPoolHash } from "@kumulo/distro-ovh-mks"
import { rejectUnconfirmedReplace } from "../../src/commands.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { buildMksPlan, emptyMksInventory, mksClusterRow, mksPoolRow, toMksPool } from "../../src/mks/plan.ts"
import { applyMksEffect } from "../../src/mks/reconcile.ts"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { baseMksEncodedConfig, decodeTestConfig } from "../fixtures.ts"

const _config = decodeTestConfig(baseMksEncodedConfig)
const _poolRow = mksPoolRow({ cluster: _config.name, pool: "general" })

const _withFlavor = (flavor: string): ClusterConfig => ({
  ..._config,
  worker_pools: _config.worker_pools.map((pool) => ({ ...pool, flavor }))
})

/** A fake OVH API with the cluster + its `general` pool already converged. */
const _converged = Effect.fn(function*() {
  const server = makeFakeMksServer()
  const mksEnv = Layer.succeed(MksEnv, { mks: makeMksClient(server.httpClient), serviceName: "service-1" })
  yield* applyMksEffect({ config: _config }).pipe(Effect.provide(mksEnv), Effect.provide(dnsNoopLive))
  const [kubeId] = [...server.clusters.keys()]
  const pools = () => [...(server.pools.get(kubeId ?? "")?.values() ?? [])]
  return { mksEnv, pools }
})

it.effect("a confirmed replace deletes the drifted pool and creates it anew", () =>
  Effect.gen(function*() {
    const { mksEnv, pools } = yield* _converged()
    const before = pools()
    assert.strictEqual(before[0]?.flavor, "b3-16")

    yield* applyMksEffect({ config: _withFlavor("b3-32"), replace: new Set([_poolRow]) }).pipe(
      Effect.provide(mksEnv),
      Effect.provide(dnsNoopLive)
    )

    const after = pools()
    assert.strictEqual(after.length, 1)
    assert.strictEqual(after[0]?.flavor, "b3-32")
    assert.notStrictEqual(after[0]?.id, before[0]?.id, "the drifted pool must be replaced, not mutated")
  }))

it.effect("an unconfirmed replace mutates nothing", () =>
  Effect.gen(function*() {
    const { mksEnv, pools } = yield* _converged()
    const before = pools()

    yield* applyMksEffect({ config: _withFlavor("b3-32") }).pipe(Effect.provide(mksEnv), Effect.provide(dnsNoopLive))

    assert.deepStrictEqual(pools(), before)
  }))

it.effect("an unconfirmed replace plan exits non-zero instead of applying", () =>
  Effect.gen(function*() {
    const drifted = _withFlavor("b3-32")
    const plan = buildMksPlan({
      config: drifted,
      inventory: {
        clusterExists: true,
        poolNames: new Set(["general"]),
        volumeNames: new Set(),
        poolHashes: new Map([["general", mksPoolHash(toMksPool({ name: "general", flavor: "b3-16", count: 2 }))]])
      }
    })
    assert.deepStrictEqual(namesToReplace(plan), new Set([_poolRow]))

    const failure = yield* rejectUnconfirmedReplace(plan).pipe(Effect.flip)
    assert.strictEqual(failure._tag, "PlanRejected")
  }))

it.effect("replacing the MKS control plane is refused outright", () =>
  Effect.gen(function*() {
    const { mksEnv, pools } = yield* _converged()
    const before = pools()

    const failure = yield* applyMksEffect({ config: _config, replace: new Set([mksClusterRow(_config.name)]) }).pipe(
      Effect.provide(mksEnv),
      Effect.provide(dnsNoopLive),
      Effect.flip
    )

    assert.strictEqual(failure._tag, "PlanRejected")
    assert.deepStrictEqual(pools(), before)
  }))

it("a pool with no stamped config hash plans as NoOp, never a replace", () => {
  const plan = buildMksPlan({
    config: _withFlavor("b3-32"),
    inventory: {
      clusterExists: true,
      poolNames: new Set(["general"]),
      volumeNames: new Set(),
      poolHashes: new Map([["general", undefined]])
    }
  })
  assert.deepStrictEqual(plan.actions.map((a) => a._tag), ["NoOp", "NoOp"])
})

it("a pool stamped with the desired hash plans as NoOp (re-plan after a replace)", () => {
  const desired = _withFlavor("b3-32")
  const [pool] = desired.worker_pools
  assert.ok(pool)
  const plan = buildMksPlan({
    config: desired,
    inventory: {
      clusterExists: true,
      poolNames: new Set(["general"]),
      volumeNames: new Set(),
      poolHashes: new Map([["general", mksPoolHash(toMksPool(pool))]])
    }
  })
  assert.deepStrictEqual(plan.actions.map((a) => a._tag), ["NoOp", "NoOp"])
  assert.deepStrictEqual(namesToReplace(plan), new Set())
})

it("scaling a stamped pool is not a replace", () => {
  const scaled: ClusterConfig = { ..._config, worker_pools: _config.worker_pools.map((pool) => ({ ...pool, count: 9 })) }
  const [pool] = _config.worker_pools
  assert.ok(pool)
  const plan = buildMksPlan({
    config: scaled,
    inventory: {
      clusterExists: true,
      poolNames: new Set(["general"]),
      volumeNames: new Set(),
      poolHashes: new Map([["general", mksPoolHash(toMksPool(pool))]])
    }
  })
  assert.deepStrictEqual(plan.actions.map((a) => a._tag), ["NoOp", "NoOp"])
})

it("nothing is planned as a replace against an empty inventory", () => {
  const plan = buildMksPlan({ config: _config, inventory: emptyMksInventory })
  assert.deepStrictEqual(namesToReplace(plan), new Set())
})
