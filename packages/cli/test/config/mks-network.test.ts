import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { FastCheck as fc } from "effect/testing"
import { decodeConfig } from "../../src/cluster-config.ts"
import { validMksConfig, validMksNetwork } from "./fixtures.ts"

const _fields = ["cidr", "nodes_subnet", "load_balancers_subnet"] as const

const _without = (field: (typeof _fields)[number]) => {
  const { [field]: _dropped, ...rest } = validMksNetwork
  return rest
}

describe("MksClusterConfig — network", () => {
  it.effect("decodes without a network block — absent means today's behaviour", () =>
    Effect.gen(function*() {
      const decoded = yield* decodeConfig(validMksConfig)
      expect(decoded.distro).toBe("ovh-mks")
      expect(decoded.distro === "ovh-mks" && decoded.network).toBeUndefined()
    }))

  it.effect("decodes a full network block, keeping both subnets distinct from the network cidr", () =>
    Effect.gen(function*() {
      const decoded = yield* decodeConfig({ ...validMksConfig, network: validMksNetwork })
      expect(decoded.distro === "ovh-mks" && decoded.network).toEqual(validMksNetwork)
    }))

  it.effect("rejects the k3s-shaped network block", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(
        decodeConfig({ ...validMksConfig, network: { cidr: "10.0.0.0/16", public_access: "nat" } })
      )
      expect(failure._tag).toBe("ConfigInvalid")
    }))

  it.prop("rejects a network block missing any one of its three cidrs", [fc.constantFrom(..._fields)], ([field]) =>
    Effect.runSync(
      Effect.gen(function*() {
        const failure = yield* Effect.flip(decodeConfig({ ...validMksConfig, network: _without(field) }))
        return failure._tag === "ConfigInvalid" && failure.issues.some((issue) => issue.path.includes("network"))
      })
    ))

  it.prop(
    "rejects a subnet that falls outside the declared cidr",
    [
      fc.constantFrom("nodes_subnet" as const, "load_balancers_subnet" as const),
      fc.constantFrom("192.168.7.0/24", "10.1.0.0/24", "10.0.0.0/8")
    ],
    ([field, outside]) =>
      Effect.runSync(
        Effect.gen(function*() {
          const network = { ...validMksNetwork, [field]: outside }
          const failure = yield* Effect.flip(decodeConfig({ ...validMksConfig, network }))
          return failure._tag === "ConfigInvalid" && failure.issues.some((issue) => issue.path.includes("network"))
        })
      )
  )

  it.prop(
    "rejects any network field that is not a cidr",
    [fc.constantFrom(..._fields), fc.constantFrom("10.0.0.0", "10.0.0.0/33", "300.0.0.0/16", "", "not-a-cidr")],
    ([field, bad]) =>
      Effect.runSync(
        Effect.gen(function*() {
          const network = { ...validMksNetwork, [field]: bad }
          const failure = yield* Effect.flip(decodeConfig({ ...validMksConfig, network }))
          return failure._tag === "ConfigInvalid"
        })
      )
  )
})

describe("MksIngress — flavor vocabulary", () => {
  const _withIngress = (ingress: Record<string, string>) => ({
    ...validMksConfig,
    network: validMksNetwork,
    ingress
  })

  it.effect("accepts a flavor name, for MKS Free's small/medium/large", () =>
    Effect.gen(function*() {
      const decoded = yield* decodeConfig(_withIngress({ flavor: "small" }))
      expect(decoded.distro === "ovh-mks" && decoded.ingress?.flavor).toBe("small")
    }))

  it.effect("accepts a flavor id, for MKS Standard's UUID", () =>
    Effect.gen(function*() {
      const decoded = yield* decodeConfig(_withIngress({ flavor_id: "0b1e-uuid" }))
      expect(decoded.distro === "ovh-mks" && decoded.ingress?.flavor_id).toBe("0b1e-uuid")
    }))

  it.effect("refuses both at once rather than silently preferring one", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(decodeConfig(_withIngress({ flavor: "small", flavor_id: "0b1e-uuid" })))
      expect(JSON.stringify(failure)).toContain("not both")
    }))
})
