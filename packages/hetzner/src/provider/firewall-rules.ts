import type { SecGroupRule } from "@kumulo/core"
import * as Schema from "effect/Schema"

export const HcloudFirewallRuleInput = Schema.Struct({
  direction: Schema.Literal("in"),
  protocol: Schema.Literals(["tcp", "udp", "icmp"]),
  // kumulo: omitted port means "all ports" for tcp/udp per hcloud semantics.
  port: Schema.optionalKey(Schema.String),
  sourceCidrs: Schema.Array(Schema.String)
})
export type HcloudFirewallRuleInput = typeof HcloudFirewallRuleInput.Type

const _port = (port: number): { readonly portMin: number; readonly portMax: number } => ({ portMin: port, portMax: port })

const _forEachCidr = (
  cidrs: ReadonlyArray<string>,
  rule: (cidr: string) => SecGroupRule
): ReadonlyArray<SecGroupRule> => cidrs.map(rule)

export const buildHetznerSecGroupRules = (options: {
  readonly allowedSshCidrs: ReadonlyArray<string>
  readonly allowedApiCidrs: ReadonlyArray<string>
  readonly networkCidr: string
  readonly cni: "flannel" | "cilium"
}): ReadonlyArray<SecGroupRule> => {
  const wireguardPort = options.cni === "flannel" ? 51820 : 51871
  const remoteCidr = options.networkCidr
  return [
    ..._forEachCidr(options.allowedSshCidrs, (cidr) => ({ protocol: "tcp", ..._port(22), remoteCidr: cidr })),
    ..._forEachCidr(options.allowedApiCidrs, (cidr) => ({ protocol: "tcp", ..._port(6443), remoteCidr: cidr })),
    { protocol: "tcp", remoteCidr },
    { protocol: "udp", remoteCidr },
    { protocol: "tcp", portMin: 2379, portMax: 2380, remoteCidr },
    { protocol: "udp", ..._port(wireguardPort), remoteCidr },
    { protocol: "icmp", remoteCidr }
  ]
}
