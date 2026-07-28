import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { clusterDrift } from "../../src/distro/cluster-drift.ts"
import type { MksClusterDrift } from "../../src/distro/cluster-drift.ts"

const _region = "GRA5"

const _drift = (
  { actual, wants }: { readonly actual: string | null | undefined; readonly wants: boolean | undefined }
): MksClusterDrift =>
  clusterDrift({
    desired: { region: _region, privateNetwork: wants },
    actual: { region: _region, privateNetworkId: actual }
  })

// `Cloud_ProjectKubeUpdate` is `{ name?, updatePolicy? }` — a cluster's network
// identity is fixed at creation, so any difference is `Blocked`, never `Upgrade`.
describe("clusterDrift — network identity (R8)", () => {
  it.prop(
    "never claims drift from a network OVH did not report",
    [fc.option(fc.boolean(), { nil: undefined })],
    ([wants]) => _drift({ actual: undefined, wants })._tag === "None"
  )

  it.prop(
    "agrees with itself: presence matching the config is never drift",
    [fc.constantFrom<string | null>(null, "net-1")],
    ([actual]) => _drift({ actual, wants: actual !== null })._tag === "None"
  )

  it("refuses a private network asked of a cluster that has none, saying recreate", () => {
    const drift = _drift({ actual: null, wants: true })
    expect(drift._tag).toBe("Blocked")
    expect(drift._tag === "Blocked" && drift.field).toBe("network")
    expect(drift._tag === "Blocked" && drift.reason).toMatch(/recreate/)
  })

  it("refuses dropping the network block from a cluster that lives on one", () => {
    const drift = _drift({ actual: "net-1", wants: false })
    expect(drift._tag).toBe("Blocked")
    expect(drift._tag === "Blocked" && drift.field).toBe("network")
    expect(drift._tag === "Blocked" && drift.reason).toMatch(/recreate/)
  })

  // An empty string is the shape `_subnetIdOf` exists to keep out of `NetworkInfo`;
  // treat it the same way here, as "no network", not as an id.
  it("treats an empty privateNetworkId as no network at all", () => {
    expect(_drift({ actual: "", wants: false })._tag).toBe("None")
    expect(_drift({ actual: "", wants: true })._tag).toBe("Blocked")
  })

  // A caller that models no networking at all (existing plan fixtures) must not
  // start reading as drift.
  it.prop(
    "makes no claim when the config says nothing about networking",
    [fc.constantFrom<string | null | undefined>(null, "net-1", undefined)],
    ([actual]) => _drift({ actual, wants: undefined })._tag === "None"
  )
})

// R8 closed at the subnet level. Presence drift only catches adding or dropping
// the whole block; editing `nodes_subnet`/`load_balancers_subnet` keeps the same
// tag-named network, so the network id is unchanged and only the resolved subnet
// ids differ. MKS fixes both at creation (`Cloud_ProjectKubeUpdate` is
// `{ name?, updatePolicy? }`), so this is `Blocked`, never `Upgrade`.
describe("clusterDrift — subnet identity (R8)", () => {
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

  it("refuses a nodes subnet that resolves elsewhere than the cluster's, saying recreate", () => {
    const drift = _subnets({ actual: { nodes: "sub-a", lbs: "sub-x" }, desired: { nodes: "sub-b", lbs: "sub-x" } })
    expect(drift._tag === "Blocked" && drift.field).toBe("network")
    expect(drift._tag === "Blocked" && drift.reason).toContain("recreate")
  })

  it("refuses a load-balancer subnet that resolves elsewhere than the cluster's", () => {
    const drift = _subnets({ actual: { nodes: "sub-a", lbs: "sub-x" }, desired: { nodes: "sub-a", lbs: "sub-y" } })
    expect(drift._tag === "Blocked" && drift.field).toBe("network")
    expect(drift._tag === "Blocked" && drift.reason).toContain("recreate")
  })

  it("claims nothing when both subnets resolve to the cluster's own", () => {
    expect(_subnets({ actual: { nodes: "sub-a", lbs: "sub-x" }, desired: { nodes: "sub-a", lbs: "sub-x" } })._tag)
      .toBe("None")
  })

  // An unresolvable CIDR is not evidence of drift: the network may simply not
  // exist yet. Absent means "can't tell", the same stance every other field takes.
  it("claims nothing when a subnet id is unknown on either side", () => {
    expect(_subnets({ actual: { nodes: "sub-a" }, desired: { nodes: undefined } })._tag).toBe("None")
    expect(_subnets({ actual: {}, desired: { nodes: "sub-b" } })._tag).toBe("None")
  })
})
