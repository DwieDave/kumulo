import { describe, expect, it } from "@effect/vitest"
import * as fc from "effect/testing/FastCheck"
import { Option } from "effect"
import { validateAutoscaling, validateCni } from "../../src/ports/validation.ts"
import type { ClusterConfigShape } from "../../src/domain/types.ts"

const poolArb = fc.record({
  name: fc.string({ minLength: 1 }),
  autoscaling: fc.option(fc.record({ enabled: fc.boolean() }), { nil: undefined })
})

describe("validateAutoscaling", () => {
  it("rejects k3s with any pool autoscaling enabled", () => {
    const config: ClusterConfigShape = {
      distro: "k3s",
      worker_pools: [{ name: "a", autoscaling: { enabled: true } }],
      addons: { cni: "flannel" }
    }
    expect(Option.isSome(validateAutoscaling(config))).toBe(true)
  })

  it("accepts ovh-mks with autoscaling enabled (native support)", () => {
    const config: ClusterConfigShape = {
      distro: "ovh-mks",
      worker_pools: [{ name: "a", autoscaling: { enabled: true } }],
      addons: { cni: "flannel" }
    }
    expect(Option.isNone(validateAutoscaling(config))).toBe(true)
  })

  it.prop("k3s is rejected iff some pool has autoscaling.enabled === true", [
    fc.array(poolArb)
  ], ([pools]) => {
    const config: ClusterConfigShape = { distro: "k3s", worker_pools: pools, addons: { cni: "flannel" } }
    const expectRejected = pools.some((p) => p.autoscaling?.enabled === true)
    expect(Option.isSome(validateAutoscaling(config))).toBe(expectRejected)
  })

  // AC8: the rejection message names the offending distro, not a hardcoded "k3s"
  it("names upcloud-uks, not k3s, in the rejection reason", () => {
    const config: ClusterConfigShape = {
      distro: "upcloud-uks",
      worker_pools: [{ name: "a", autoscaling: { enabled: true } }],
      addons: { cni: "flannel" }
    }
    const rejected = validateAutoscaling(config)
    expect(Option.isSome(rejected) && rejected.value.reason.includes("upcloud-uks")).toBe(true)
  })
})

describe("validateCni", () => {
  it("rejects cilium under ovh-mks", () => {
    const config: ClusterConfigShape = { distro: "ovh-mks", worker_pools: [], addons: { cni: "cilium" } }
    expect(Option.isSome(validateCni(config))).toBe(true)
  })

  it("accepts cilium under k3s", () => {
    const config: ClusterConfigShape = { distro: "k3s", worker_pools: [], addons: { cni: "cilium" } }
    expect(Option.isNone(validateCni(config))).toBe(true)
  })

  it("accepts flannel under ovh-mks", () => {
    const config: ClusterConfigShape = { distro: "ovh-mks", worker_pools: [], addons: { cni: "flannel" } }
    expect(Option.isNone(validateCni(config))).toBe(true)
  })

  it("accepts flannel under k3s", () => {
    const config: ClusterConfigShape = { distro: "k3s", worker_pools: [], addons: { cni: "flannel" } }
    expect(Option.isNone(validateCni(config))).toBe(true)
  })
})
