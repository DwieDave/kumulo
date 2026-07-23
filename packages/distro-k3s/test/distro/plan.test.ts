import { describe, expect, it } from "@effect/vitest"
import type { Inventory } from "@kumulo/core"
import { bootstrapOrder } from "../../src/distro/plan.ts"

describe("bootstrapOrder", () => {
  it("orders masters before workers", () => {
    const inventory: Inventory = {
      servers: [
        { id: "1", name: "worker-1", ip: "10.0.0.4" },
        { id: "2", name: "master-1", ip: "10.0.0.1" },
        { id: "3", name: "worker-2", ip: "10.0.0.5" },
        { id: "4", name: "master-2", ip: "10.0.0.2" }
      ],
      networks: [],
      securityGroups: [],
      loadBalancers: []
    }
    const order = bootstrapOrder(inventory)
    expect(order.slice(0, 2).toSorted()).toEqual(["master-1", "master-2"])
    expect(order.slice(2).toSorted()).toEqual(["worker-1", "worker-2"])
  })
})
