import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "@effect/vitest"
import { makeNetworkClient, makeNodeGroupsClient, makeRouterClient, makeUksClient } from "@kumulo/upcloud"
import {
  deleteAll,
  deleteNetwork,
  ensureCluster,
  ensureNetwork,
  ensureNodePools,
  fetchKubeconfig,
  findClusterByName,
  listNodeGroups,
  uksNetworkLabels,
  upgradeCluster
} from "../../src/distro/index.ts"
import { desiredIpFilter } from "../../src/distro/ensure-cluster.ts"
import type { UksClients, UksClusterConfig, UksClusterRef } from "../../src/distro/types.ts"
import { makeFakeUksServer } from "./fake-uks-server.ts"

const _clients = (httpClient: ReturnType<typeof makeFakeUksServer>["httpClient"]): UksClients => ({
  uks: makeUksClient(httpClient),
  nodeGroups: makeNodeGroupsClient(httpClient),
  network: makeNetworkClient(httpClient),
  router: makeRouterClient(httpClient)
})

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

describe("upcloud-uks distro driver (fake server)", () => {
  it.effect("ensures network, cluster and node pools, then fetches a kubeconfig and deletes everything", () =>
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

  it.effect("re-running ensureNetwork/ensureCluster/ensureNodePools converges (re-entrancy)", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)

      const network1 = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      const info1 = yield* ensureCluster({ clients, config: _config, networkUuid: network1.networkUuid, owner: _owner })
      const ref1: UksClusterRef = { uuid: info1.uuid, name: info1.name }
      yield* ensureNodePools({ clients, ref: ref1, pools: _config.worker_pools, owner: _owner })

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

  it.effect("a label-only patch still sends control_plane_ip_filter", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)
      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      yield* ensureCluster({ clients, config: _config, networkUuid: network.networkUuid, owner: _owner })
      const scaled = { ..._config, worker_pools: [{ ..._pool, count: 5 }] }
      yield* ensureCluster({ clients, config: scaled, networkUuid: network.networkUuid, owner: _owner })

      expect(server.clusterPatches).toHaveLength(1)
      expect(server.clusterPatches.every((body) => "control_plane_ip_filter" in body)).toBe(true)
      expect(server.clusterPatches[0]?.control_plane_ip_filter).toEqual(["0.0.0.0/0"])
    }))

  it.effect("a config without a filter keeps a live filter", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)
      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      const info = yield* ensureCluster({ clients, config: _config, networkUuid: network.networkUuid, owner: _owner })
      const live = server.clusters.get(info.uuid)

      if (live !== undefined) live.control_plane_ip_filter = ["10.0.0.0/8"]
      const scaled = { ..._config, worker_pools: [{ ..._pool, count: 5 }] }
      yield* ensureCluster({ clients, config: scaled, networkUuid: network.networkUuid, owner: _owner })

      expect(server.clusterPatches).toHaveLength(1)
      expect(server.clusterPatches[0]?.control_plane_ip_filter).toEqual(["10.0.0.0/8"])
      expect(server.clusters.get(info.uuid)?.control_plane_ip_filter).toEqual(["10.0.0.0/8"])
    }))

  it("desiredIpFilter prefers config, then live, then open", () => {
    expect(desiredIpFilter({ config: ["1.2.3.4/32"], live: ["10.0.0.0/8"] })).toEqual(["1.2.3.4/32"])
    expect(desiredIpFilter({ live: ["10.0.0.0/8"] })).toEqual(["10.0.0.0/8"])
    expect(desiredIpFilter({ live: [] })).toEqual([])
    expect(desiredIpFilter({ live: null })).toEqual(["0.0.0.0/0"])
    expect(desiredIpFilter({})).toEqual(["0.0.0.0/0"])
  })

  it.effect("ensureNodePools scales a pool as an Update, no replace", () =>
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

  it.effect("ensureNodePools replaces (create-then-delete) only when the pool is confirmed", () =>
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

      yield* ensureNodePools({ clients, ref, pools: drifted, owner: _owner })
      const unconfirmed = yield* listNodeGroups({ clients, ref })
      expect(unconfirmed).toHaveLength(1)
      expect(unconfirmed[0]?.name).toBe(oldLiveName)

      yield* ensureNodePools({ clients, ref, pools: drifted, owner: _owner, replace: new Set(["workers"]) })
      const replaced = yield* listNodeGroups({ clients, ref })
      expect(replaced).toHaveLength(1)
      expect(replaced[0]?.name).not.toBe(oldLiveName)
    }))

  it.effect("adopts an unlabelled legacy network and router by name and labels them", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)
      server.routers.set("rtr-legacy", { uuid: "rtr-legacy", name: "c1-router" })

      server.networks.set("net-legacy", {
        uuid: "net-legacy",
        name: "c1-network",
        zone: "de-fra1",
        router: "rtr-legacy",
        ip_networks: { ip_network: [] }
      })

      const ensured = yield* ensureNetwork({ clients, clusterName: "c1", zone: "de-fra1", cidr: "10.0.0.0/24" })
      expect(ensured).toEqual({ networkUuid: "net-legacy", routerUuid: "rtr-legacy" })
      expect(server.networks.size).toBe(1)
      expect(server.routers.size).toBe(1)
      expect(server.networks.get("net-legacy")?.labels).toEqual(uksNetworkLabels("c1"))
      expect(server.routers.get("rtr-legacy")?.labels).toEqual(uksNetworkLabels("c1"))
    }))

  it.effect("creates labelled resources and does not adopt a network from another zone", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)

      server.networks.set("net-hel", {
        uuid: "net-hel",
        name: "c1-network",
        zone: "fi-hel1",
        labels: uksNetworkLabels("c1"),
        ip_networks: { ip_network: [] }
      })

      const ensured = yield* ensureNetwork({ clients, clusterName: "c1", zone: "de-fra1", cidr: "10.0.0.0/24" })
      expect(ensured.networkUuid).not.toBe("net-hel")
      expect(server.networks.size).toBe(2)
      expect(server.networks.get(ensured.networkUuid)?.zone).toBe("de-fra1")
      expect(server.networks.get(ensured.networkUuid)?.labels).toEqual(uksNetworkLabels("c1"))
      expect(server.routers.get(ensured.routerUuid)?.labels).toEqual(uksNetworkLabels("c1"))
    }))

  it.effect("deleteNetwork keeps a same-named network owned by another cluster", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)

      server.networks.set("net-other", {
        uuid: "net-other",
        name: "c1-network",
        zone: "de-fra1",
        labels: [{ key: "kumulo-cluster", value: "other" }],
        ip_networks: { ip_network: [] }
      })

      yield* deleteNetwork({ clients, clusterName: "c1", zone: "de-fra1" })
      expect(server.networks.has("net-other")).toBe(true)
    }))

  it.effect("deleteAll retries NETWORK_NOT_EMPTY conflicts, then removes the router", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0, networkDeleteConflicts: 2 })
      const clients = _clients(server.httpClient)
      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      const info = yield* ensureCluster({ clients, config: _config, networkUuid: network.networkUuid, owner: _owner })

      const fiber = yield* Effect.forkChild(
        deleteAll({ clients, ref: { uuid: info.uuid, name: info.name }, clusterName: _config.name, zone: _config.zone })
      )

      yield* TestClock.adjust("30 seconds")
      yield* Fiber.join(fiber)
      expect(server.networks.size).toBe(0)
      expect(server.routers.size).toBe(0)
    }))
})
