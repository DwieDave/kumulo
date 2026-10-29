import { describe, expect, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { validateAutoscaling, validateCni } from "../../src/ports/validation.ts"
import type { ClusterConfigFields } from "../../src/domain/types.ts"

const poolArb = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  autoscaling: Schema.UndefinedOr(Schema.Struct({ enabled: Schema.Boolean }))
})

describe("validateAutoscaling", () => {
  it("rejects k3s with any pool autoscaling enabled", () => {
    const config: ClusterConfigFields = {
      distro: "k3s",
      worker_pools: [{ name: "a", autoscaling: { enabled: true } }],
      addons: { cni: "flannel" }
    }

    expect(Option.isSome(validateAutoscaling(config))).toBe(true)
  })

  it("accepts ovh-mks with autoscaling enabled (native support)", () => {
    const config: ClusterConfigFields = {
      distro: "ovh-mks",
      worker_pools: [{ name: "a", autoscaling: { enabled: true } }],
      addons: { cni: "flannel" }
    }

    expect(Option.isNone(validateAutoscaling(config))).toBe(true)
  })

  it.prop("k3s is rejected iff some pool has autoscaling.enabled === true", [
    Schema.Array(poolArb)
  ], ([pools]) => {
    const config: ClusterConfigFields = { distro: "k3s", worker_pools: pools, addons: { cni: "flannel" } }
    const expectRejected = pools.some((p) => p.autoscaling?.enabled === true)
    expect(Option.isSome(validateAutoscaling(config))).toBe(expectRejected)
  })

  // AC8: the rejection message names the offending distro, not a hardcoded "k3s"
  it("names upcloud-uks, not k3s, in the rejection reason", () => {
    const config: ClusterConfigFields = {
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
    const config: ClusterConfigFields = { distro: "ovh-mks", worker_pools: [], addons: { cni: "cilium" } }
    expect(Option.isSome(validateCni(config))).toBe(true)
  })

  it("accepts cilium under k3s", () => {
    const config: ClusterConfigFields = { distro: "k3s", worker_pools: [], addons: { cni: "cilium" } }
    expect(Option.isNone(validateCni(config))).toBe(true)
  })

  it("accepts flannel under ovh-mks", () => {
    const config: ClusterConfigFields = { distro: "ovh-mks", worker_pools: [], addons: { cni: "flannel" } }
    expect(Option.isNone(validateCni(config))).toBe(true)
  })

  it("accepts flannel under k3s", () => {
    const config: ClusterConfigFields = { distro: "k3s", worker_pools: [], addons: { cni: "flannel" } }
    expect(Option.isNone(validateCni(config))).toBe(true)
  })
})
