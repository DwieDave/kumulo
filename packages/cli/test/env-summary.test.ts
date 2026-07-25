import { describe, expect, it } from "vitest"
import { providerSections, renderEnvSummary } from "../src/env-summary.ts"
import type { ClusterConfig, K3sClusterConfigEncoded, MksClusterConfigEncoded } from "@kumulo/core"
import { baseEncodedConfig, baseMksEncodedConfig, decodeTestConfig } from "./fixtures.ts"

const _config = (overrides: Partial<K3sClusterConfigEncoded>): ClusterConfig =>
  decodeTestConfig({ ...baseEncodedConfig, ...overrides })

const _mksConfig = (overrides: Partial<MksClusterConfigEncoded>): ClusterConfig =>
  decodeTestConfig({ ...baseMksEncodedConfig, ...overrides })

describe("providerSections", () => {
  it("ovh-mks config lists OVH vars plus each wired module", () => {
    const sections = providerSections(
      _mksConfig({
        dns: { ...baseMksEncodedConfig.dns, module: "hetzner" },
        object_storage: { module: "ovh", buckets: [] },
        secrets: {
          sink: "sops",
          dir: ".",
          sops: { age_recipient: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqql4pcnf" }
        }
      })
    )
    expect(sections.map((s) => s.title)).toEqual([
      "provider: ovh (ovh api)",
      "dns: hetzner",
      "object_storage: ovh"
    ])
    expect(sections[0]?.vars).toContain("OVH_CLIENT_SECRET")
    expect(sections[1]?.vars).toEqual(["HETZNER_DNS_TOKEN"])
  })

  it("hetzner k3s config lists HCLOUD_TOKEN", () => {
    const sections = providerSections(
      _config({
        provider: "hetzner",
        auth: { method: "api_token", region: "fsn1" },
        volumes: { module: "hcloud", managed: [] }
      })
    )
    expect(sections.map((s) => s.vars)).toEqual([["HCLOUD_TOKEN"], ["HCLOUD_TOKEN"]])
  })
})

describe("renderEnvSummary", () => {
  it("redacts present vars and marks missing ones", () => {
    const out = renderEnvSummary({
      sections: [{ title: "provider: ovh (ovh api)", vars: ["OVH_CLIENT_ID", "OVH_CLIENT_SECRET"] }],
      present: (name) => name === "OVH_CLIENT_SECRET"
    })
    expect(out).toContain("OVH_CLIENT_SECRET=<redacted>")
    expect(out).toContain("OVH_CLIENT_ID (not set)")
    expect(out).not.toMatch(/OVH_CLIENT_ID=/)
  })
})
