import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { describe, expect, it } from "@effect/vitest"
import { makeNetworkClient, makeNodeGroupsClient, makeRouterClient, makeUksClient } from "@kumulo/upcloud"
import { compareMinor, resolveUpgradeTarget, UpgradeTarget } from "../../src/distro/upgrade.ts"
import { upgradeCluster } from "../../src/distro/upgrade-cluster.ts"
import type { UksClients } from "../../src/distro/types.ts"
import { makeFakeUksServer } from "./fake-uks-server.ts"

describe("resolveUpgradeTarget", () => {
  it("NEXT_MINOR takes the first available-upgrades entry", () => {
    const target = resolveUpgradeTarget({ strategy: "NEXT_MINOR", currentVersion: "1.30", availableUpgrades: ["1.31", "1.32"] })
    expect(target).toEqual(UpgradeTarget.Upgrade({ version: "1.31" }))
  })

  it("NEXT_MINOR with no upgrades available reports already current", () => {
    const target = resolveUpgradeTarget({ strategy: "NEXT_MINOR", currentVersion: "1.31", availableUpgrades: [] })
    expect(target).toEqual(UpgradeTarget.AlreadyCurrent())
  })

  it("LATEST_PATCH always reports already current — UKS has no patch versions (D12)", () => {
    const target = resolveUpgradeTarget({ strategy: "LATEST_PATCH", currentVersion: "1.30", availableUpgrades: ["1.31"] })
    expect(target).toEqual(UpgradeTarget.AlreadyCurrent())
  })

  it("NEXT_MINOR picks the lowest version above the current one regardless of order", () => {
    const target = resolveUpgradeTarget({ strategy: "NEXT_MINOR", currentVersion: "1.30", availableUpgrades: ["1.32", "1.31"] })
    expect(target).toEqual(UpgradeTarget.Upgrade({ version: "1.31" }))
  })

  it("NEXT_MINOR compares minors numerically and ignores versions not above current", () => {
    const target = resolveUpgradeTarget({ strategy: "NEXT_MINOR", currentVersion: "1.9", availableUpgrades: ["1.10", "1.8", "1.9"] })
    expect(target).toEqual(UpgradeTarget.Upgrade({ version: "1.10" }))
  })
})

describe("compareMinor", () => {
  it("compares major.minor numerically", () => {
    expect(compareMinor({ a: "1.9", b: "1.10" })).toBeLessThan(0)
    expect(compareMinor({ a: "1.31", b: "1.30" })).toBeGreaterThan(0)
    expect(compareMinor({ a: "1.31", b: "1.31" })).toBe(0)
  })
})

describe("upgradeCluster (fake server)", () => {
  it.effect("sends the manual strategy object and waits for running after the POST", () =>
    Effect.gen(function*() {
      const server = makeFakeUksServer({ readyAfterPolls: 2 })

      const clients: UksClients = {
        uks: makeUksClient(server.httpClient),
        nodeGroups: makeNodeGroupsClient(server.httpClient),
        network: makeNetworkClient(server.httpClient),
        router: makeRouterClient(server.httpClient)
      }

      const created = yield* clients.uks.create({ name: "demo", zone: "de-fra1", version: "1.30", network: "net-1", network_cidr: "10.0.0.0/24" })
      server.upgrades.set(created.uuid, ["1.32", "1.31"])
      const before = server.clusterGets.length

      const fiber = yield* Effect.forkChild(
        upgradeCluster({ clients, uuid: created.uuid, currentVersion: "1.30", strategy: "NEXT_MINOR", upgradeStrategy: "manual" })
      )

      yield* TestClock.adjust("1 minute")
      yield* Fiber.join(fiber)

      expect(server.upgradeRequests).toEqual([{ version: "1.31", strategy: { type: "manual" } }])
      expect(server.clusterGets.length - before).toBeGreaterThanOrEqual(3)
      expect(server.clusters.get(created.uuid)?.state).toBe("running")
    }))
})
