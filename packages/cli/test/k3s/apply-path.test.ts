import { assert, it } from "@effect/vitest"
import { distroFor } from "../../src/distro/registry.ts"
import { baseEncodedConfig, decodeK3sTestConfig } from "../fixtures.ts"

it("a k3s apply without a cdn block applies directly, never through the converge-all path", () => {
  const config = decodeK3sTestConfig(baseEncodedConfig)
  assert.deepStrictEqual(distroFor(config).appliedPrefixes, [])
  assert.isTrue(distroFor(config).selfProgress === true)
})

it("a k3s config with the cdn module none has no cdn prefix either", () => {
  const config = decodeK3sTestConfig({ ...baseEncodedConfig, cdn: { module: "none" } })
  assert.deepStrictEqual(distroFor(config).appliedPrefixes, [])
})
