import { describe, expect, it } from "@effect/vitest"
import { MANAGED_PHASES, phasesForKind, SELF_MANAGED_PHASES } from "../../src/reconcile/phases.ts"

describe("phasesForKind", () => {
  it("orders self-managed phases", () => {
    expect(phasesForKind("self-managed")).toEqual([
      "Network",
      "Security",
      "ServerGroups",
      "LB",
      "Nodes",
      "Bootstrap",
      "Addons",
      "DNS",
      "Volumes",
      "Kubeconfig"
    ])
    expect(phasesForKind("self-managed")).toBe(SELF_MANAGED_PHASES)
  })

  it("orders managed phases (skips infra phases)", () => {
    expect(phasesForKind("managed")).toEqual([
      "EnsureCluster",
      "EnsureNodePools",
      "Addons",
      "DNS",
      "Volumes",
      "Kubeconfig"
    ])
    expect(phasesForKind("managed")).toBe(MANAGED_PHASES)
  })
})
