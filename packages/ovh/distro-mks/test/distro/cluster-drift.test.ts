import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { clusterDrift, MksClusterDrift } from "../../src/distro/cluster-drift.ts"

const _region = "GRA5"

const _drift = (
  { actual, wants }: { readonly actual: string | null | undefined; readonly wants: boolean | undefined }
): MksClusterDrift =>
  clusterDrift({
    desired: { region: _region, privateNetwork: wants },
    actual: { region: _region, privateNetworkId: actual }
  })

const _subnets = (
  { actual, desired }: {
    readonly actual: { readonly nodes?: string; readonly lbs?: string }
    readonly desired: { readonly nodes?: string; readonly lbs?: string }
  }
): MksClusterDrift =>
  clusterDrift({
    desired: {
      region: _region,
      privateNetwork: true,
      nodesSubnetId: desired.nodes,
      loadBalancersSubnetId: desired.lbs
    },
    actual: {
      region: _region,
      privateNetworkId: "net-1",
      nodesSubnetId: actual.nodes,
      loadBalancersSubnetId: actual.lbs
    }
  })

describe("clusterDrift — network identity", () => {
  it.prop(
    "never claims drift from a network OVH did not report",
    [Schema.UndefinedOr(Schema.Boolean)],
    ([wants]) => MksClusterDrift.$is("None")(_drift({ actual: undefined, wants }))
  )

  it.prop(
    "agrees with itself: presence matching the config is never drift",
    [Schema.NullOr(Schema.Literal("net-1"))],
    ([actual]) => MksClusterDrift.$is("None")(_drift({ actual, wants: actual !== null }))
  )

  it("refuses a private network asked of a cluster that has none, saying recreate", () => {
    const drift = _drift({ actual: null, wants: true })
    expect(MksClusterDrift.$is("Blocked")(drift)).toBe(true)
    expect(MksClusterDrift.$is("Blocked")(drift) && drift.field).toBe("network")
    expect(MksClusterDrift.$is("Blocked")(drift) && drift.reason).toMatch(/recreate/)
  })

  it("refuses dropping the network block from a cluster that lives on one", () => {
    const drift = _drift({ actual: "net-1", wants: false })
    expect(MksClusterDrift.$is("Blocked")(drift)).toBe(true)
    expect(MksClusterDrift.$is("Blocked")(drift) && drift.field).toBe("network")
    expect(MksClusterDrift.$is("Blocked")(drift) && drift.reason).toMatch(/recreate/)
  })

  it("treats an empty privateNetworkId as no network at all", () => {
    expect(MksClusterDrift.$is("None")(_drift({ actual: "", wants: false }))).toBe(true)
    expect(MksClusterDrift.$is("Blocked")(_drift({ actual: "", wants: true }))).toBe(true)
  })

  it.prop(
    "makes no claim when the config says nothing about networking",
    [Schema.UndefinedOr(Schema.NullOr(Schema.Literal("net-1")))],
    ([actual]) => MksClusterDrift.$is("None")(_drift({ actual, wants: undefined }))
  )
})

describe("clusterDrift — subnet identity", () => {
  it("refuses a nodes subnet that resolves elsewhere than the cluster's, saying recreate", () => {
    const drift = _subnets({ actual: { nodes: "sub-a", lbs: "sub-x" }, desired: { nodes: "sub-b", lbs: "sub-x" } })
    expect(MksClusterDrift.$is("Blocked")(drift) && drift.field).toBe("network")
    expect(MksClusterDrift.$is("Blocked")(drift) && drift.reason).toContain("recreate")
  })

  it("refuses a load-balancer subnet that resolves elsewhere than the cluster's", () => {
    const drift = _subnets({ actual: { nodes: "sub-a", lbs: "sub-x" }, desired: { nodes: "sub-a", lbs: "sub-y" } })
    expect(MksClusterDrift.$is("Blocked")(drift) && drift.field).toBe("network")
    expect(MksClusterDrift.$is("Blocked")(drift) && drift.reason).toContain("recreate")
  })

  it("claims nothing when both subnets resolve to the cluster's own", () => {
    expect(
      MksClusterDrift.$is("None")(
        _subnets({ actual: { nodes: "sub-a", lbs: "sub-x" }, desired: { nodes: "sub-a", lbs: "sub-x" } })
      )
    ).toBe(true)
  })

  it("claims nothing when a subnet id is unknown on either side", () => {
    expect(MksClusterDrift.$is("None")(_subnets({ actual: { nodes: "sub-a" }, desired: { nodes: undefined } }))).toBe(true)
    expect(MksClusterDrift.$is("None")(_subnets({ actual: {}, desired: { nodes: "sub-b" } }))).toBe(true)
  })
})
