import { describe, expect, it } from "@effect/vitest"
import { resolveUpgradeTarget } from "../../src/distro/upgrade.ts"

describe("resolveUpgradeTarget", () => {
  it("NEXT_MINOR takes the first available-upgrades entry", () => {
    const target = resolveUpgradeTarget({ strategy: "NEXT_MINOR", currentVersion: "1.30", availableUpgrades: ["1.31", "1.32"] })
    expect(target).toEqual({ _tag: "Upgrade", version: "1.31" })
  })

  it("NEXT_MINOR with no upgrades available reports already current", () => {
    const target = resolveUpgradeTarget({ strategy: "NEXT_MINOR", currentVersion: "1.31", availableUpgrades: [] })
    expect(target).toEqual({ _tag: "AlreadyCurrent" })
  })

  it("LATEST_PATCH always reports already current — UKS has no patch versions (D12)", () => {
    const target = resolveUpgradeTarget({ strategy: "LATEST_PATCH", currentVersion: "1.30", availableUpgrades: ["1.31"] })
    expect(target).toEqual({ _tag: "AlreadyCurrent" })
  })
})
