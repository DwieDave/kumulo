import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { makeMksClient } from "../../src/client/mks.ts"
import { ensureCluster } from "../../src/distro/ensure-cluster.ts"
import type { MksDriverConfig } from "../../src/distro/types.ts"
import { makeFakeMksServer } from "./fake-mks-server.ts"

const _base: MksDriverConfig = {
  serviceName: "service-1",
  name: "prod-eu",
  region: "GRA5",
  version: "1.31",
  worker_pools: []
}

const _ids = {
  privateNetworkId: "net-1",
  nodesSubnetId: "subnet-nodes-1",
  loadBalancersSubnetId: "subnet-lb-1"
} as const

it.effect("posts all three network ids in the creation payload", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer({ readyAfterPolls: 0 })
    const info = yield* ensureCluster({ mks: makeMksClient(server.httpClient), config: { ..._base, ..._ids } })
    const created = server.clusters.get(info.id)
    assert.strictEqual(created?.privateNetworkId, _ids.privateNetworkId)
    assert.strictEqual(created?.nodesSubnetId, _ids.nodesSubnetId)
    assert.strictEqual(created?.loadBalancersSubnetId, _ids.loadBalancersSubnetId)
  }))

it.effect("omits the network ids entirely when the config carries none", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer({ readyAfterPolls: 0 })
    const info = yield* ensureCluster({ mks: makeMksClient(server.httpClient), config: _base })
    const created = server.clusters.get(info.id)
    assert.strictEqual(created?.privateNetworkId, undefined)
    assert.strictEqual(created?.nodesSubnetId, undefined)
    assert.strictEqual(created?.loadBalancersSubnetId, undefined)
  }))
