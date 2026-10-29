import { describe, expect, it } from "@effect/vitest"
import { clusterDrift, UksClusterDrift, VersionDrift, versionDrift } from "../../src/distro/cluster-drift.ts"
import type { UksClusterState, UksDesiredCluster } from "../../src/distro/cluster-drift.ts"

const _desired: UksDesiredCluster = {
  zone: "fi-hel2",
  plan: "dev-md",
  networkCidr: "10.0.0.0/24",
  storageEncryption: true,
  privateNodeGroups: true
}

const _actual: UksClusterState = {
  zone: "fi-hel2",
  plan: "dev-md",
  networkCidr: "10.0.0.0/24",
  storageEncryption: true,
  privateNodeGroups: true
}

describe("clusterDrift", () => {
  it("is None when nothing creation-time-only has changed", () => {
    expect(clusterDrift({ desired: _desired, actual: _actual })).toEqual(UksClusterDrift.None())
  })

  it("refuses (never mutates) on zone drift", () => {
    const drift = clusterDrift({ desired: { ..._desired, zone: "de-fra1" }, actual: _actual })
    expect(drift._tag).toBe("Blocked")
    expect(drift).toMatchObject({ field: "zone" })
  })

  it("refuses on plan drift", () => {
    const drift = clusterDrift({ desired: { ..._desired, plan: "prod-md" }, actual: _actual })
    expect(drift._tag).toBe("Blocked")
    expect(drift).toMatchObject({ field: "plan" })
  })

  it("refuses on network CIDR drift", () => {
    const drift = clusterDrift({ desired: { ..._desired, networkCidr: "10.9.0.0/24" }, actual: _actual })
    expect(drift._tag).toBe("Blocked")
    expect(drift).toMatchObject({ field: "network_cidr" })
  })

  it("refuses on storage_encryption drift", () => {
    const drift = clusterDrift({ desired: { ..._desired, storageEncryption: false }, actual: _actual })
    expect(drift._tag).toBe("Blocked")
    expect(drift).toMatchObject({ field: "storage_encryption" })
  })

  it("refuses on private_node_groups drift", () => {
    const drift = clusterDrift({ desired: { ..._desired, privateNodeGroups: false }, actual: _actual })
    expect(drift._tag).toBe("Blocked")
    expect(drift).toMatchObject({ field: "private_node_groups" })
  })

  it("makes no claim ('can't tell') when a field was never read", () => {
    const drift = clusterDrift({ desired: _desired, actual: { ..._actual, plan: undefined } })
    expect(drift).toEqual(UksClusterDrift.None())
  })
})

// AC6: the network is compared by CIDR, not by "is one attached". Comparing a
// boolean made every live cluster look correct, since a cluster always has a
// network — so an edited `network.cidr` planned as NoOp and applied nothing.
it("blocks when the configured network CIDR differs from the live one (AC6)", () => {
  const drift = clusterDrift({
    desired: { zone: "de-fra1", networkCidr: "10.1.0.0/24" },
    actual: { zone: "de-fra1", networkCidr: "10.0.0.0/24" }
  })

  expect(drift._tag).toBe("Blocked")

  if (UksClusterDrift.$is("Blocked")(drift)) {
    expect(drift.field).toBe("network_cidr")
    expect(drift.reason).toContain("10.1.0.0/24")
  }
})

it("does not fabricate network drift when the CIDRs agree", () => {
  const drift = clusterDrift({
    desired: { zone: "de-fra1", networkCidr: "10.0.0.0/24" },
    actual: { zone: "de-fra1", networkCidr: "10.0.0.0/24" }
  })

  expect(drift._tag).toBe("None")
})

describe("versionDrift", () => {
  it("is None when the minors match", () => {
    expect(versionDrift({ live: "1.31", desired: "1.31" })).toEqual(VersionDrift.None())
  })

  it("is Behind when the live minor is lower than the config", () => {
    expect(versionDrift({ live: "1.30", desired: "1.31" })).toEqual(VersionDrift.Behind({ live: "1.30", desired: "1.31" }))
  })

  it("is Ahead when the live minor is higher than the config", () => {
    expect(versionDrift({ live: "1.31", desired: "1.30" })).toEqual(VersionDrift.Ahead({ live: "1.31", desired: "1.30" }))
  })
})
