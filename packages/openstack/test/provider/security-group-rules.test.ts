import { describe, expect, it } from "@effect/vitest"
import { buildFr57Rules } from "../../src/provider/security-group-rules.ts"

describe("buildFr57Rules", () => {
  it("encodes every security group rule for flannel", () => {
    const rules = buildFr57Rules({
      allowedSshCidrs: ["1.2.3.0/24"],
      allowedApiCidrs: ["4.5.6.0/24"],
      networkCidr: "10.0.0.0/24",
      cni: "flannel"
    })
    expect(rules).toContainEqual({ protocol: "tcp", portMin: 22, portMax: 22, remoteCidr: "1.2.3.0/24" })
    expect(rules).toContainEqual({ protocol: "tcp", portMin: 6443, portMax: 6443, remoteCidr: "4.5.6.0/24" })
    expect(rules).toContainEqual({ protocol: "any", remoteCidr: "10.0.0.0/24" })
    expect(rules).toContainEqual({ protocol: "tcp", portMin: 2379, portMax: 2380, remoteGroupSelf: true })
    expect(rules).toContainEqual({ protocol: "udp", portMin: 51820, portMax: 51820, remoteGroupSelf: true })
    expect(rules).toContainEqual({ protocol: "icmp", remoteCidr: "10.0.0.0/24" })
  })

  it("switches the wireguard port to 51871 for cilium", () => {
    const rules = buildFr57Rules({ allowedSshCidrs: [], allowedApiCidrs: [], networkCidr: "10.0.0.0/24", cni: "cilium" })
    expect(rules).toContainEqual({ protocol: "udp", portMin: 51871, portMax: 51871, remoteGroupSelf: true })
  })

  it("emits one ssh/api rule per allowed cidr", () => {
    const rules = buildFr57Rules({
      allowedSshCidrs: ["1.0.0.0/8", "2.0.0.0/8"],
      allowedApiCidrs: ["3.0.0.0/8"],
      networkCidr: "10.0.0.0/24",
      cni: "flannel"
    })
    expect(rules.filter((rule) => rule.portMin === 22)).toHaveLength(2)
    expect(rules.filter((rule) => rule.portMin === 6443)).toHaveLength(1)
  })
})
