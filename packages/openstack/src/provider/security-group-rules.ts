import * as Schema from "effect/Schema"

// kumulo: one rule descriptor per Neutron security-group-rule call. `remoteGroupSelf`
// means "from members of this same security group" (master-to-master / intra-pool).
export const SecurityGroupRuleInput = Schema.Struct({
  protocol: Schema.Literals(["tcp", "udp", "icmp", "any"]),
  portMin: Schema.optionalKey(Schema.Number),
  portMax: Schema.optionalKey(Schema.Number),
  remoteCidr: Schema.optionalKey(Schema.String),
  remoteGroupSelf: Schema.optionalKey(Schema.Boolean)
})
export type SecurityGroupRuleInput = typeof SecurityGroupRuleInput.Type

const _forEachCidr = (
  cidrs: ReadonlyArray<string>,
  rule: (cidr: string) => SecurityGroupRuleInput
): ReadonlyArray<SecurityGroupRuleInput> => cidrs.map(rule)

// ponytail: anti-affinity/SG granularity is masters-vs-workers, not per-pool
// (ServerSpec carries no pool id yet) — upgrade when the port grows one.
export const buildFr57Rules = (options: {
  readonly allowedSshCidrs: ReadonlyArray<string>
  readonly allowedApiCidrs: ReadonlyArray<string>
  readonly networkCidr: string
  readonly cni: "flannel" | "cilium"
}): ReadonlyArray<SecurityGroupRuleInput> => {
  const wireguardPort = options.cni === "flannel" ? 51820 : 51871
  return [
    ..._forEachCidr(options.allowedSshCidrs, (remoteCidr) => ({ protocol: "tcp", portMin: 22, portMax: 22, remoteCidr })),
    ..._forEachCidr(options.allowedApiCidrs, (remoteCidr) => ({ protocol: "tcp", portMin: 6443, portMax: 6443, remoteCidr })),
    { protocol: "any", remoteCidr: options.networkCidr },
    { protocol: "tcp", portMin: 2379, portMax: 2380, remoteGroupSelf: true },
    { protocol: "udp", portMin: wireguardPort, portMax: wireguardPort, remoteGroupSelf: true },
    { protocol: "icmp", remoteCidr: options.networkCidr }
  ]
}
