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

describe("MksClusterConfig — network (R5, D1)", () => {
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

  // The k3s block is `{ cidr, public_access }`: no subnets, and a bastion
  // concept a managed control plane has no use for. Sharing the struct would
  // ship a dead field on MKS, so the two must not be interchangeable.
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

  // `cidr` is the network's declared address space and nothing else reads it —
  // Neutron only ever sees the two subnet CIDRs. Unchecked it is a required
  // field that does nothing, and a subnet outside the network an operator
  // believes they declared decodes clean.
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

// Q1: MKS Standard names an Octavia flavor by UUID, MKS Free by size name.
// Before this, only the UUID was expressible, so a Free-plan cluster could not
// ask for a load-balancer size at all.
describe("MksIngress — flavor vocabulary (Q1)", () => {
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

  // Both name the same Octavia field. Honouring one and dropping the other
  // would be a silent choice, so the config has to pick.
  it.effect("refuses both at once rather than silently preferring one", () =>
    Effect.gen(function*() {
      const failure = yield* Effect.flip(decodeConfig(_withIngress({ flavor: "small", flavor_id: "0b1e-uuid" })))
      expect(JSON.stringify(failure)).toContain("not both")
    }))
})
