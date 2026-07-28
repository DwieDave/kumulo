import { describe, expect, it } from "vitest"
import { missingCredentials, providerSections, renderEnvSummary } from "../src/env-summary.ts"
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
        dns: { module: "hetzner", zone: "example.com", ttl: 300, records: [] },
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

// An unset credential used to surface as `GET /cloud/project//kube` — the empty
// path segment being the only hint that OVH_SERVICE_NAME was missing. The
// fallback MksEnv attaches a hint to a failing HttpClient, but that hint is
// unreachable: with no credentials there is no base-URL mapping either, so the
// request stays relative and dies as InvalidUrlError before the handler runs.
describe("missingCredentials", () => {
  const _present = (set: ReadonlyArray<string>) => (name: string) => set.includes(name)

  it("names the unset OVH vars an ovh-mks config cannot run without", () => {
    const missing = missingCredentials({
      config: _mksConfig({}),
      present: _present(["OVH_CLIENT_ID"])
    })
    expect(missing).toContain("OVH_SERVICE_NAME")
    expect(missing).toContain("OVH_CLIENT_SECRET")
    expect(missing).not.toContain("OVH_CLIENT_ID")
  })

  it("includes a wired dns module's token", () => {
    const missing = missingCredentials({
      config: _mksConfig({ dns: { module: "hetzner", zone: "example.com", ttl: 300, records: [] } }),
      present: _present([])
    })
    expect(missing).toContain("HETZNER_DNS_TOKEN")
  })

  // The OS_* set is auth-method dependent (`loadCredentials` picks a path from
  // what is present), so requiring all of them would reject valid setups.
  it("never demands the auth-method-dependent OS_* vars", () => {
    const missing = missingCredentials({
      config: _mksConfig({ volumes: { module: "cinder", managed: [] } }),
      present: _present([])
    })
    expect(missing.filter((name) => name.startsWith("OS_"))).toEqual([])
  })

  it("is empty when everything required is set", () => {
    const missing = missingCredentials({
      config: _mksConfig({}),
      present: _present(["OVH_CLIENT_ID", "OVH_CLIENT_SECRET", "OVH_SERVICE_NAME"])
    })
    expect(missing).toEqual([])
  })
})
