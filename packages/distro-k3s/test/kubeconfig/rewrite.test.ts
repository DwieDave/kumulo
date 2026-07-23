import { describe, expect, it } from "@effect/vitest"
import { resolveServerUrl, rewriteKubeconfig } from "../../src/kubeconfig/rewrite.ts"

const RAW = `apiVersion: v1
clusters:
- cluster:
    server: https://127.0.0.1:6443
  name: default
contexts:
- context:
    cluster: default
    user: default
  name: default
current-context: default
users:
- name: default
`

describe("resolveServerUrl", () => {
  it("prefers LB VIP over DNS name and master IP", () => {
    expect(resolveServerUrl({ lbVip: "10.0.0.100", apiDnsName: "api.example.com", masterIp: "10.0.0.1" }))
      .toBe("https://10.0.0.100:6443")
  })

  it("falls back to DNS name when no LB VIP", () => {
    expect(resolveServerUrl({ apiDnsName: "api.example.com", masterIp: "10.0.0.1" }))
      .toBe("https://api.example.com:6443")
  })

  it("falls back to master IP when neither LB VIP nor DNS name", () => {
    expect(resolveServerUrl({ masterIp: "10.0.0.1" })).toBe("https://10.0.0.1:6443")
  })
})

describe("rewriteKubeconfig", () => {
  it("rewrites server and renames cluster/context/user to the cluster name", () => {
    const out = rewriteKubeconfig({ content: RAW, clusterName: "my-cluster", serverUrl: "https://10.0.0.100:6443" })
    expect(out).toContain("server: https://10.0.0.100:6443")
    expect(out).not.toContain("127.0.0.1")
    expect(out).not.toMatch(/: default/)
    expect(out).toContain("current-context: my-cluster")
    expect((out.match(/my-cluster/g) ?? []).length).toBeGreaterThanOrEqual(5)
  })
})
