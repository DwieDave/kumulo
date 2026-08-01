import { FastCheck as fc } from "effect/testing"
import { assert, it } from "@effect/vitest"
import { buildHetznerSecGroupRules } from "../../src/provider/firewall-rules.ts"

const cidr = fc.stringMatching(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\/[0-9]{1,2}$/)
const cidrs = fc.uniqueArray(cidr, { maxLength: 5 })
const cni = fc.constantFrom("flannel", "cilium")

it.prop("every input SSH/API CIDR appears in exactly one rule for its port", [cidrs, cidrs, cidr, cni], ([sshCidrs, apiCidrs, networkCidr, cniKind]) => {
  const rules = buildHetznerSecGroupRules({ allowedSshCidrs: sshCidrs, allowedApiCidrs: apiCidrs, networkCidr, cni: cniKind })
  const countFor = (target: string, port: number) =>
    rules.filter((rule) => rule.portMin === port && rule.remoteCidr === target).length
  return sshCidrs.every((c) => countFor(c, 22) === 1) && apiCidrs.every((c) => countFor(c, 6443) === 1)
})

it("uses distinct ports for SSH (22) vs API (6443) rules", () => {
  const rules = buildHetznerSecGroupRules({ allowedSshCidrs: ["1.2.3.0/24"], allowedApiCidrs: ["1.2.3.0/24"], networkCidr: "10.0.0.0/16", cni: "flannel" })
  const ssh = rules.find((rule) => rule.remoteCidr === "1.2.3.0/24" && rule.portMin === 22)
  const api = rules.find((rule) => rule.remoteCidr === "1.2.3.0/24" && rule.portMin === 6443)
  assert.isDefined(ssh)
  assert.isDefined(api)
})

it("uses the CNI-specific wireguard port (flannel 51820, cilium 51871)", () => {
  const flannel = buildHetznerSecGroupRules({ allowedSshCidrs: [], allowedApiCidrs: [], networkCidr: "10.0.0.0/16", cni: "flannel" })
  const cilium = buildHetznerSecGroupRules({ allowedSshCidrs: [], allowedApiCidrs: [], networkCidr: "10.0.0.0/16", cni: "cilium" })
  assert.isDefined(flannel.find((rule) => rule.protocol === "udp" && rule.portMin === 51820))
  assert.isDefined(cilium.find((rule) => rule.protocol === "udp" && rule.portMin === 51871))
})

// Hetzner Firewalls support neither protocol:"any" nor a self-reference.
it("emits no `any` protocol and no remoteGroupSelf", () => {
  const rules = buildHetznerSecGroupRules({ allowedSshCidrs: [], allowedApiCidrs: [], networkCidr: "10.0.0.0/16", cni: "flannel" })
  assert.isFalse(rules.some((rule) => rule.protocol === "any" || rule.remoteGroupSelf === true))
})
