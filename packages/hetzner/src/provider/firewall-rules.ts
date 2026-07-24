import * as Schema from "effect/Schema"

// kumulo: one rule descriptor per Hetzner Firewall rule (direction/protocol/
// port/source_ips shape — no `esp`/`gre` support needed for this port).
// Hetzner has no security-group self-reference concept (unlike OpenStack's
// `remoteGroupSelf`) — intra-cluster rules use the network CIDR as their
// source instead.
export const HcloudFirewallRuleInput = Schema.Struct({
  direction: Schema.Literal("in"),
  protocol: Schema.Literals(["tcp", "udp", "icmp"]),
  // kumulo: omitted `port` means "all ports" for tcp/udp per hcloud semantics.
  port: Schema.optionalKey(Schema.String),
  sourceCidrs: Schema.Array(Schema.String)
})
export type HcloudFirewallRuleInput = typeof HcloudFirewallRuleInput.Type

const _forEachCidr = (
  cidrs: ReadonlyArray<string>,
  rule: (cidr: string) => HcloudFirewallRuleInput
): ReadonlyArray<HcloudFirewallRuleInput> => cidrs.map(rule)

// mirrors `buildFr57Rules`'s inputs (SSH/API CIDRs, intra-network allow, etcd,
// CNI-specific wireguard port) — Hetzner Firewall's rule shape instead of
// Neutron security-group-rules (R7).
export const buildHcloudFirewallRules = (options: {
  readonly allowedSshCidrs: ReadonlyArray<string>
  readonly allowedApiCidrs: ReadonlyArray<string>
  readonly networkCidr: string
  readonly cni: "flannel" | "cilium"
}): ReadonlyArray<HcloudFirewallRuleInput> => {
  const wireguardPort = options.cni === "flannel" ? 51820 : 51871
  return [
    ..._forEachCidr(options.allowedSshCidrs, (cidr) => ({ direction: "in", protocol: "tcp", port: "22", sourceCidrs: [cidr] })),
    ..._forEachCidr(options.allowedApiCidrs, (cidr) => ({ direction: "in", protocol: "tcp", port: "6443", sourceCidrs: [cidr] })),
    { direction: "in", protocol: "tcp", sourceCidrs: [options.networkCidr] },
    { direction: "in", protocol: "udp", sourceCidrs: [options.networkCidr] },
    { direction: "in", protocol: "tcp", port: "2379-2380", sourceCidrs: [options.networkCidr] },
    { direction: "in", protocol: "udp", port: `${wireguardPort}`, sourceCidrs: [options.networkCidr] },
    { direction: "in", protocol: "icmp", sourceCidrs: [options.networkCidr] }
  ]
}
