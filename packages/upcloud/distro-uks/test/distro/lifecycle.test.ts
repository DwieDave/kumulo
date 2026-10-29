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

  it.effect("ensureNodePools sends user labels, kumulo labels and parsed taints", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)
      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      const info = yield* ensureCluster({ clients, config: _config, networkUuid: network.networkUuid, owner: _owner })
      const ref: UksClusterRef = { uuid: info.uuid, name: info.name }
      const pool = { ..._pool, labels: [{ key: "role", value: "gpu" }], taints: ["dedicated=gpu:NoExecute", "gpu"] }
      yield* ensureNodePools({ clients, ref, pools: [pool], owner: _owner })

      const group = [...(server.nodeGroups.get(info.uuid)?.values() ?? [])][0]
      const keys = group?.labels?.map((label) => label.key)
      expect(group?.labels).toContainEqual({ key: "role", value: "gpu" })
      expect(keys).toEqual(expect.arrayContaining(["kumulo-pool", "kumulo-owner", "kumulo-config-hash"]))
      expect(group?.taints).toEqual([
        { key: "dedicated", value: "gpu", effect: "NoExecute" },
        { key: "gpu", value: "", effect: "NoSchedule" }
      ])
    }))

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
      const fiber = yield* Effect.forkChild(ensureNodePools({ clients, ref, pools: scaled, owner: _owner }))

      yield* TestClock.adjust("30 seconds")
      yield* Fiber.join(fiber)
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

  it.effect("maps storage_encryption none, data-at-rest and null onto a boolean", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)

      const base = {
        zone: "de-fra1",
        network: "net-1",
        network_cidr: "10.0.0.0/24",
        version: "1.31",
        plan: "dev-md",
        state: "running",
        control_plane_ip_filter: null,
        pollsRemaining: 0,
        notFoundPolls: 0
      }

      server.clusters.set("a", { ...base, uuid: "a", name: "a", storage_encryption: "none" })
      server.clusters.set("b", { ...base, uuid: "b", name: "b", storage_encryption: "data-at-rest" })
      server.clusters.set("c", { ...base, uuid: "c", name: "c", storage_encryption: null })
      server.clusters.set("d", { ...base, uuid: "d", name: "d" })

      const encrypted = yield* Effect.forEach(["a", "b", "c", "d"], (name) =>
        findClusterByName({ clients, name }).pipe(Effect.map((info) => info?.storageEncryption)))

      expect(encrypted).toEqual([false, true, false, false])

      const info = yield* findClusterByName({ clients, name: "a" })
      expect(info?.version).toBe("1.31")
    }))

  it.effect("ensureCluster refuses a live version ahead of the config", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)
      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      yield* ensureCluster({ clients, config: { ..._config, version: "1.31" }, networkUuid: network.networkUuid, owner: _owner })

      const error = yield* ensureCluster({
        clients,
        config: { ..._config, version: "1.30" },
        networkUuid: network.networkUuid,
        owner: _owner
      }).pipe(Effect.flip)

      expect(error._tag).toBe("ResourceConflict")
    }))

  it.effect("ensureCluster tolerates a live version behind the config and does not upgrade", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)
      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      yield* ensureCluster({ clients, config: { ..._config, version: "1.30" }, networkUuid: network.networkUuid, owner: _owner })

      const info = yield* ensureCluster({
        clients,
        config: { ..._config, version: "1.31" },
        networkUuid: network.networkUuid,
        owner: _owner
      })

      expect(info.version).toBe("1.30")
      expect(server.upgradeRequests).toHaveLength(0)
    }))

  it.effect("ensureCluster tolerates early 404s right after create", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0, notFoundPollsAfterCreate: 2 })
      const clients = _clients(server.httpClient)
      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })

      const fiber = yield* Effect.forkChild(
        ensureCluster({ clients, config: _config, networkUuid: network.networkUuid, owner: _owner })
      )

      yield* TestClock.adjust("30 seconds")
      const info = yield* Fiber.join(fiber)
      expect(info.status).toBe("running")
    }))

  it.effect("ensureCluster fails fast when the cluster enters failed", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ failClusterOnCreate: true })
      const clients = _clients(server.httpClient)
      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })

      const error = yield* Effect.flip(
        ensureCluster({ clients, config: _config, networkUuid: network.networkUuid, owner: _owner })
      )

      expect(error._tag).toBe("ProviderApiError")
    }))

  it.effect("a pool replace waits until the old group returns 404", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0, terminatingPolls: 2 })
      const clients = _clients(server.httpClient)
      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      const info = yield* ensureCluster({ clients, config: _config, networkUuid: network.networkUuid, owner: _owner })
      const ref: UksClusterRef = { uuid: info.uuid, name: info.name }
      yield* ensureNodePools({ clients, ref, pools: _config.worker_pools, owner: _owner })

      const fiber = yield* Effect.forkChild(
        ensureNodePools({
          clients,
          ref,
          pools: [{ ..._pool, plan: "2xCPU-4GB" }],
          owner: _owner,
          replace: new Set(["workers"])
        })
      )

      yield* TestClock.adjust("30 seconds")
      yield* Fiber.join(fiber)
      expect(server.nodeGroups.get(info.uuid)?.size).toBe(1)
    }))

  it.effect("listNodeGroups skips terminating groups", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0, terminatingPolls: 5 })
      const clients = _clients(server.httpClient)
      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      const info = yield* ensureCluster({ clients, config: _config, networkUuid: network.networkUuid, owner: _owner })
      const ref: UksClusterRef = { uuid: info.uuid, name: info.name }
      yield* ensureNodePools({ clients, ref, pools: _config.worker_pools, owner: _owner })
      const [group] = yield* listNodeGroups({ clients, ref })
      yield* clients.nodeGroups.delete(ref.uuid, group?.name ?? "")

      expect(server.nodeGroups.get(info.uuid)?.size).toBe(1)
      expect(yield* listNodeGroups({ clients, ref })).toHaveLength(0)
    }))

  it.effect("a scale waits for running", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 0 })
      const clients = _clients(server.httpClient)
      const network = yield* ensureNetwork({ clients, clusterName: _config.name, zone: _config.zone, cidr: _config.network.cidr })
      const info = yield* ensureCluster({ clients, config: _config, networkUuid: network.networkUuid, owner: _owner })
      const ref: UksClusterRef = { uuid: info.uuid, name: info.name }
      yield* ensureNodePools({ clients, ref, pools: _config.worker_pools, owner: _owner })

      const fiber = yield* Effect.forkChild(ensureNodePools({ clients, ref, pools: [{ ..._pool, count: 5 }], owner: _owner }))

      yield* TestClock.adjust("30 seconds")
      yield* Fiber.join(fiber)
      expect([...(server.nodeGroups.get(info.uuid)?.values() ?? [])].map((group) => group.state)).toEqual(["running"])
    }))
})
