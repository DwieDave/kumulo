import { FastCheck as fc } from "effect/testing"
import { assert, it } from "@effect/vitest"
import { buildHcloudFirewallRules } from "../../src/provider/firewall-rules.ts"

const cidr = fc.stringMatching(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\/[0-9]{1,2}$/)
const cidrs = fc.uniqueArray(cidr, { maxLength: 5 })
const cni = fc.constantFrom("flannel", "cilium")

// Property: every SSH CIDR appears in exactly one port-22 rule, and every API
// CIDR in exactly one port-6443 rule (N9) — no CIDR dropped, none duplicated.
// Checked per-port (not "appears in exactly one rule overall") since the same
// CIDR value can legitimately be passed for both SSH and API allowlists.
it.prop("every input SSH/API CIDR appears in exactly one rule for its port", [cidrs, cidrs, cidr, cni], ([sshCidrs, apiCidrs, networkCidr, cniKind]) => {
  const rules = buildHcloudFirewallRules({ allowedSshCidrs: sshCidrs, allowedApiCidrs: apiCidrs, networkCidr, cni: cniKind })
  const countFor = (target: string, port: string) =>
    rules.filter((rule) => rule.port === port && rule.sourceCidrs.includes(target)).length
  return sshCidrs.every((c) => countFor(c, "22") === 1) && apiCidrs.every((c) => countFor(c, "6443") === 1)
})

it("uses distinct ports for SSH (22) vs API (6443) rules", () => {
  const rules = buildHcloudFirewallRules({ allowedSshCidrs: ["1.2.3.0/24"], allowedApiCidrs: ["1.2.3.0/24"], networkCidr: "10.0.0.0/16", cni: "flannel" })
  const ssh = rules.find((rule) => rule.sourceCidrs.includes("1.2.3.0/24") && rule.port === "22")
  const api = rules.find((rule) => rule.sourceCidrs.includes("1.2.3.0/24") && rule.port === "6443")
  assert.isDefined(ssh)
  assert.isDefined(api)
})

it("uses the CNI-specific wireguard port (flannel 51820, cilium 51871)", () => {
  const flannel = buildHcloudFirewallRules({ allowedSshCidrs: [], allowedApiCidrs: [], networkCidr: "10.0.0.0/16", cni: "flannel" })
  const cilium = buildHcloudFirewallRules({ allowedSshCidrs: [], allowedApiCidrs: [], networkCidr: "10.0.0.0/16", cni: "cilium" })
  assert.isDefined(flannel.find((rule) => rule.protocol === "udp" && rule.port === "51820"))
  assert.isDefined(cilium.find((rule) => rule.protocol === "udp" && rule.port === "51871"))
})
