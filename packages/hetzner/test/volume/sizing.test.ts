import { FastCheck as fc } from "effect/testing"
import { expect, it } from "@effect/vitest"
import { enforceMinimumVolumeSize, HCLOUD_MIN_VOLUME_SIZE_GB } from "../../src/volume/sizing.ts"

// Property (N9): any size always rounds up to at least the 10Gi floor, and a
// request already at/above the floor passes through unchanged.
it.prop("result is always >= the 10Gi minimum", [fc.integer({ min: 1, max: 10_000 })], ([requestedGb]) => {
  expect(enforceMinimumVolumeSize(requestedGb)).toBeGreaterThanOrEqual(HCLOUD_MIN_VOLUME_SIZE_GB)
})

it.prop("requests at/above the minimum pass through unchanged", [fc.integer({ min: HCLOUD_MIN_VOLUME_SIZE_GB, max: 10_000 })], ([requestedGb]) => {
  expect(enforceMinimumVolumeSize(requestedGb)).toBe(requestedGb)
})

it("rounds a below-minimum request up to exactly the floor", () => {
  expect(enforceMinimumVolumeSize(5)).toBe(HCLOUD_MIN_VOLUME_SIZE_GB)
})
