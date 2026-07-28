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
