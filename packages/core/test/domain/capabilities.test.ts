import { describe, expect, it } from "@effect/vitest"
import { distroCapabilities } from "../../src/domain/capabilities.ts"

// T1.4 (R17) — upcloud-uks has no autoscaler and no selectable CNI, same
// shape as ovh-mks's autoscaling / k3s's CNI story.
describe("distroCapabilities", () => {
  it("upcloud-uks: no autoscaling, no selectable CNI", () => {
    expect(distroCapabilities["upcloud-uks"]).toEqual({ autoscaling: false, selectableCni: false })
  })
})
