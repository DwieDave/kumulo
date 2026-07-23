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
      workerPools: [{ name: "a", autoscaling: { enabled: true } }],
      cni: "flannel"
    }
    expect(Option.isSome(validateAutoscaling(config))).toBe(true)
  })

  it("accepts ovh-mks with autoscaling enabled (native support)", () => {
    const config: ClusterConfigShape = {
      distro: "ovh-mks",
      workerPools: [{ name: "a", autoscaling: { enabled: true } }],
      cni: "flannel"
    }
    expect(Option.isNone(validateAutoscaling(config))).toBe(true)
  })

  it.prop("k3s is rejected iff some pool has autoscaling.enabled === true", [
    fc.array(poolArb)
  ], ([pools]) => {
    const config: ClusterConfigShape = { distro: "k3s", workerPools: pools, cni: "flannel" }
    const expectRejected = pools.some((p) => p.autoscaling?.enabled === true)
    expect(Option.isSome(validateAutoscaling(config))).toBe(expectRejected)
  })
})

describe("validateCni", () => {
  it("rejects cilium under ovh-mks", () => {
    const config: ClusterConfigShape = { distro: "ovh-mks", workerPools: [], cni: "cilium" }
    expect(Option.isSome(validateCni(config))).toBe(true)
  })

  it("accepts cilium under k3s", () => {
    const config: ClusterConfigShape = { distro: "k3s", workerPools: [], cni: "cilium" }
    expect(Option.isNone(validateCni(config))).toBe(true)
  })

  it("accepts flannel under ovh-mks", () => {
    const config: ClusterConfigShape = { distro: "ovh-mks", workerPools: [], cni: "flannel" }
    expect(Option.isNone(validateCni(config))).toBe(true)
  })
})
