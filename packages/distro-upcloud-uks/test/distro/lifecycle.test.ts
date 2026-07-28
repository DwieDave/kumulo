import { Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { makeNetworkClient, makeNodeGroupsClient, makeRouterClient, makeUksClient } from "@kumulo/upcloud"
import {
  deleteAll,
  ensureCluster,
  ensureNetwork,
  ensureNodePools,
  fetchKubeconfig,
  findClusterByName,
  listNodeGroups,
  upgradeCluster
} from "../../src/distro/index.ts"
import type { UksClients, UksClusterConfig, UksClusterRef } from "../../src/distro/types.ts"
import { makeFakeUksServer } from "./fake-uks-server.ts"

const _clients = (httpClient: ReturnType<typeof makeFakeUksServer>["httpClient"]): UksClients => ({
  uks: makeUksClient(httpClient),
  nodeGroups: makeNodeGroupsClient(httpClient),
  network: makeNetworkClient(httpClient),
  router: makeRouterClient(httpClient)
})

// Named separately so the drift cases below can spread it without indexing
// back into `_config.worker_pools` (which is optional-typed at every index).
const _pool = { name: "workers", plan: "1xCPU-2GB", count: 2 }

const _config: UksClusterConfig = {
  name: "demo",
  zone: "de-fra1",
  version: "1.31",
  plan: "dev-md",
  network: { cidr: "10.0.0.0/24" },
  worker_pools: [_pool],
  storage_encryption: true
}

const _owner = "kumulo"

describe("upcloud-uks distro driver (fake server, D13)", () => {
  it.effect("ensures network, cluster and node pools, then fetches a kubeconfig and deletes everything (AC1, AC3)", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)

      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      expect(network.networkUuid).toBeTruthy()
      expect(network.routerUuid).toBeTruthy()

      const info = yield* ensureCluster({ clients, config: _config, networkUuid: network.networkUuid, owner: _owner })
      expect(info.status).toBe("running")
      expect(info.networkCidr).toBe(_config.network.cidr)
      expect(info.storageEncryption).toBe(true)
      // D7: the configured version must reach UpCloud. Asserted against what the
      // server stored, not against the config — the fake echoes what it was sent.
      const created = yield* clients.uks.get(info.uuid)
      expect(created.version).toBe(_config.version)

      const ref: UksClusterRef = { uuid: info.uuid, name: info.name }
      yield* ensureNodePools({ clients, ref, pools: _config.worker_pools, owner: _owner })
      const groups = yield* listNodeGroups({ clients, ref })
      expect(groups).toHaveLength(1)
      expect(groups[0]?.count).toBe(2)
      expect(groups[0]?.poolLabel).toBe("workers")

      const kubeconfig = yield* fetchKubeconfig({ clients, uuid: info.uuid })
      expect(kubeconfig.content).toContain("apiVersion: v1")

      server.upgrades.set(info.uuid, ["1.32"])
      yield* upgradeCluster({
        clients,
        uuid: info.uuid,
        currentVersion: "1.31",
        strategy: "NEXT_MINOR",
        upgradeStrategy: "rolling-update"
      })
      expect(server.clusters.get(info.uuid)?.version).toBe("1.32")

      yield* deleteAll({ clients, ref, clusterName: _config.name })
      expect(server.clusters.size).toBe(0)
      expect(server.networks.size).toBe(0)
      expect(server.routers.size).toBe(0)
    }))

  it.effect("re-running ensureNetwork/ensureCluster/ensureNodePools converges (N5 re-entrancy, AC2)", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)

      const network1 = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      const info1 = yield* ensureCluster({ clients, config: _config, networkUuid: network1.networkUuid, owner: _owner })
      const ref1: UksClusterRef = { uuid: info1.uuid, name: info1.name }
      yield* ensureNodePools({ clients, ref: ref1, pools: _config.worker_pools, owner: _owner })

      // Simulate an interrupted run resumed from scratch: re-derive everything
      // by name instead of reusing the ids/refs from the first pass.
      const network2 = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      expect(network2).toEqual(network1)
      expect(server.networks.size).toBe(1)
      expect(server.routers.size).toBe(1)

      const info2 = yield* ensureCluster({ clients, config: _config, networkUuid: network2.networkUuid, owner: _owner })
      expect(info2.uuid).toBe(info1.uuid)
      expect(server.clusters.size).toBe(1)

      const ref2: UksClusterRef = { uuid: info2.uuid, name: info2.name }
      yield* ensureNodePools({ clients, ref: ref2, pools: _config.worker_pools, owner: _owner })
      const groups = yield* listNodeGroups({ clients, ref: ref2 })
      expect(groups).toHaveLength(1)

      const found = yield* findClusterByName({ clients, name: _config.name })
      expect(found?.uuid).toBe(info1.uuid)
    }))

  it.effect("ensureNodePools scales a pool as an Update, no replace (AC4)", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)
      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      const info = yield* ensureCluster({ clients, config: _config, networkUuid: network.networkUuid, owner: _owner })
      const ref: UksClusterRef = { uuid: info.uuid, name: info.name }
      yield* ensureNodePools({ clients, ref, pools: _config.worker_pools, owner: _owner })
      const before = yield* listNodeGroups({ clients, ref })
      const liveName = before[0]?.name

      const scaled = [{ ..._pool, count: 5 }]
      yield* ensureNodePools({ clients, ref, pools: scaled, owner: _owner })
      const after = yield* listNodeGroups({ clients, ref })
      expect(after).toHaveLength(1)
      expect(after[0]?.name).toBe(liveName)
      expect(after[0]?.count).toBe(5)
    }))

  it.effect("ensureNodePools replaces (create-then-delete) only when the pool is confirmed (D9, AC5)", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)
      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      const info = yield* ensureCluster({ clients, config: _config, networkUuid: network.networkUuid, owner: _owner })
      const ref: UksClusterRef = { uuid: info.uuid, name: info.name }
      yield* ensureNodePools({ clients, ref, pools: _config.worker_pools, owner: _owner })
      const before = yield* listNodeGroups({ clients, ref })
      const oldLiveName = before[0]?.name

      const drifted = [{ ..._pool, plan: "2xCPU-4GB" }]

      // Unconfirmed: left strictly alone.
      yield* ensureNodePools({ clients, ref, pools: drifted, owner: _owner })
      const unconfirmed = yield* listNodeGroups({ clients, ref })
      expect(unconfirmed).toHaveLength(1)
      expect(unconfirmed[0]?.name).toBe(oldLiveName)

      // Confirmed: create-then-delete, new generation live before the old is gone.
      yield* ensureNodePools({ clients, ref, pools: drifted, owner: _owner, replace: new Set(["workers"]) })
      const replaced = yield* listNodeGroups({ clients, ref })
      expect(replaced).toHaveLength(1)
      expect(replaced[0]?.name).not.toBe(oldLiveName)
    }))
})
