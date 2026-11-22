import { assert, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { CloudProvider } from "@kumulo/core"
import type { Inventory } from "@kumulo/core"
import { k3sDnsTargetsEffect } from "../../src/k3s/reconcile.ts"
import { baseEncodedConfig, decodeK3sTestConfig } from "../fixtures.ts"

const _config = decodeK3sTestConfig(baseEncodedConfig)

// only `listClusterResources` is on the resolve path; the rest die if called.
const _unused = Effect.die("not part of the dns targets path")

const _inventory = (inventory: Pick<Inventory, "servers" | "loadBalancers">): Layer.Layer<CloudProvider> =>
  Layer.succeed(CloudProvider, {
    ensureNetwork: () => _unused,
    findNetwork: () => _unused,
    hasGateway: () => _unused,
    ensureSecurityGroups: () => _unused,
    ensureLoadBalancer: () => _unused,
    ensureServer: () => _unused,
    deleteServer: () => _unused,
    deleteByTag: () => _unused,
    resolveImage: () => _unused,
    resolveFlavor: () => _unused,
    listClusterResources: () => Effect.succeed({ networks: [], securityGroups: [], ...inventory })
  })

const _master = { id: "srv-0", name: "kumulo-prod-eu-master-0", ip: "10.0.0.10" }
const _worker = { id: "srv-1", name: "kumulo-prod-eu-worker-general-0", ip: "10.0.0.11" }

it.effect("resolves api_server to the load balancer VIP, as apply writes it", () =>
  Effect.gen(function*() {
    const targets = yield* k3sDnsTargetsEffect(_config).pipe(
      Effect.provide(_inventory({ servers: [_worker, _master], loadBalancers: [{ id: "lb-1", vip: "203.0.113.20" }] }))
    )

    assert.deepStrictEqual(targets, { api_server: { kind: "ip", value: "203.0.113.20" } })
  }))

it.effect("falls back to the first master's IP without a load balancer", () =>
  Effect.gen(function*() {
    const targets = yield* k3sDnsTargetsEffect(_config).pipe(Effect.provide(_inventory({ servers: [_worker, _master], loadBalancers: [] })))

    assert.deepStrictEqual(targets, { api_server: { kind: "ip", value: "10.0.0.10" } })
  }))

it.effect("is undefined when the cluster has no master", () =>
  Effect.gen(function*() {
    const targets = yield* k3sDnsTargetsEffect(_config).pipe(Effect.provide(_inventory({ servers: [_worker], loadBalancers: [] })))

    assert.isUndefined(targets)
  }))
