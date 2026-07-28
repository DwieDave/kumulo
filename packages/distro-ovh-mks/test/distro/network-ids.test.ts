import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { makeMksClient } from "../../src/client/mks.ts"
import { ensureCluster } from "../../src/distro/ensure-cluster.ts"
import type { MksClusterConfig } from "../../src/distro/types.ts"
import { makeFakeMksServer } from "./fake-mks-server.ts"

const _base: MksClusterConfig = {
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

// R6 — MKS networking is a creation-time input (`Cloud_ProjectKubeUpdate` is
// `{ name?, updatePolicy? }`), so an id the CLI resolves but never posts is an
// id the cluster can never be given.
it.effect("posts all three network ids in the creation payload", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer({ readyAfterPolls: 0 })
    const info = yield* ensureCluster({ mks: makeMksClient(server.httpClient), config: { ..._base, ..._ids } })
    const created = server.clusters.get(info.id)
    assert.strictEqual(created?.privateNetworkId, _ids.privateNetworkId)
    assert.strictEqual(created?.nodesSubnetId, _ids.nodesSubnetId)
    assert.strictEqual(created?.loadBalancersSubnetId, _ids.loadBalancersSubnetId)
  }))

// R5 — a config with no `network` block must keep posting nothing, so a
// project without a vRack still provisions exactly as it does today.
it.effect("omits the network ids entirely when the config carries none", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer({ readyAfterPolls: 0 })
    const info = yield* ensureCluster({ mks: makeMksClient(server.httpClient), config: _base })
    const created = server.clusters.get(info.id)
    assert.strictEqual(created?.privateNetworkId, undefined)
    assert.strictEqual(created?.nodesSubnetId, undefined)
    assert.strictEqual(created?.loadBalancersSubnetId, undefined)
  }))
