/**
 * The ovh-mks cluster-config variant. Shared building blocks come from
 * `@kumulo/core`; the MKS-only network/ingress vocabulary is defined here.
 * The `ClusterConfig` union over all variants is assembled in `@kumulo/cli`.
 */
import { Schema } from "effect"
import {
  Cidr,
  cidrRange,
  commonClusterFields,
  Dns,
  isAuthMethodConsistentWithProvider,
  isSecretsRequiredForObjectStorage,
  OpenStackVolumes
} from "@kumulo/core"

const PlainK8sVersion = Schema.String.check(
  Schema.isPattern(/^v?\d+\.\d+\.\d+$/, { message: "must be a Kubernetes version like v1.31.4" })
)

// kumulo: `cidr` is the network's declared address space and nothing downstream
// reads it — Neutron only ever sees the two subnet CIDRs. Unchecked it is a
// required field that does nothing, and a subnet outside the network an
// operator believes they declared would decode clean.
const _SUBNET_FIELDS = ["nodes_subnet", "load_balancers_subnet"] as const
const isSubnetsWithinCidr = Schema.makeFilter(
  (network: { cidr: string; nodes_subnet: string; load_balancers_subnet: string }) => {
    const [first, last] = cidrRange(network.cidr)
    const outside = _SUBNET_FIELDS.filter((field) => {
      const [start, end] = cidrRange(network[field])
      return start < first || end > last
    })
    return outside.length === 0 ? undefined : `${outside.join(" and ")} must be inside cidr ${network.cidr}`
  }
)

// kumulo: MKS's network block is deliberately NOT k3s's. `public_access` is a
// bastion concept a managed control plane has no use for, and MKS takes two
// distinct subnet ids at cluster creation (nodes, load balancers — D1), so both
// are explicit rather than one derived from the other.
// kumulo: OVH's own `cloud.network.GatewayModelEnum`. The gateway is created
// through OVH's API rather than Neutron precisely because this is the one thing
// Neutron's router has no field for, and it is what the gateway is billed on.
const GatewayModel = Schema.Literals(["s", "m", "l", "xl", "2xl", "3xl"])

const MksNetwork = Schema.Struct({
  cidr: Cidr,
  nodes_subnet: Cidr,
  load_balancers_subnet: Cidr,
  /**
   * Bandwidth tier of the gateway created with this network (`s` is OVH's
   * default). A gateway is not optional — nodes reach the internet through its
   * SNAT, and a floating IP cannot be associated with a port whose subnet has
   * no router carrying an external gateway — so only its size is a choice.
   */
  gateway_model: Schema.optionalKey(GatewayModel)
}).check(isSubnetsWithinCidr)

// kumulo: presence is the switch, exactly as `network`'s is — an `ingress`
// block means the cluster gets one public Octavia load balancer, absent means
// it gets none. Everything that shapes the LB is set at creation (D4): OVH
// ignores the feature annotations once a Service adopts an LB by id.
// ponytail: no proxy-protocol or timeout fields. Those are pool settings, and
// the pool belongs to the cloud-controller-manager once a Service adopts the LB
// (D2/R14) — a field kumulo cannot honour is worse than none. Q2 stays open.
const MksIngress = Schema.Struct({
  /** Octavia flavor id — MKS Standard's vocabulary. Absent = Octavia's default. */
  flavor_id: Schema.optionalKey(Schema.NonEmptyString),
  /**
   * Octavia flavor *name* — `small` (default), `medium`, `large`, `xl`. The MKS
   * Free plan accepts only this vocabulary; MKS Standard also accepts a flavor
   * UUID (Q1). Neither plan makes the load balancer itself free: every Public
   * Cloud Load Balancer is billed per flavor, and its floating IP separately.
   * Resolved against the region's own flavor list, so an unknown name fails
   * naming what exists instead of silently handing back Octavia's default.
   */
  flavor: Schema.optionalKey(Schema.NonEmptyString)
})

// Both name the same Octavia field; honouring one and dropping the other would
// be a silent choice, so the config has to pick.
const isFlavorUnambiguous = Schema.makeFilter((config: { ingress?: { flavor?: unknown; flavor_id?: unknown } }) =>
  config.ingress?.flavor !== undefined && config.ingress?.flavor_id !== undefined
    ? "ingress.flavor and ingress.flavor_id both set: use the name (MKS Free) or the id (MKS Standard), not both"
    : undefined
)

// An LB Octavia places wherever it likes is unreachable from the cluster, so
// `ingress` is only meaningful alongside the `network` block that supplies the
// load-balancer subnet (R10).
const isIngressPlaceable = Schema.makeFilter((config: { network?: unknown; ingress?: unknown }) =>
  config.ingress !== undefined && config.network === undefined
    ? "ingress requires a network block: the load balancer's VIP must sit on the cluster's load_balancers_subnet"
    : undefined
)

// MKS's control plane, networking and node access are OVH-managed, so the
// k3s-only blocks are absent and provider is fixed to ovh — which structurally
// subsumes the addons and volumes gates (no addons block, cinder|none only);
// the auth gate still bites, since `api_token` stays expressible.
export const MksClusterConfig = Schema.Struct({
  ...commonClusterFields,
  provider: Schema.Literal("ovh"),
  distro: Schema.Literal("ovh-mks"),
  version: PlainK8sVersion,
  dns: Dns,
  volumes: OpenStackVolumes,
  // Optional: absent keeps today's behaviour (OVH's default public addressing).
  // Networking is a creation-time input to MKS and can never be changed after
  // (`Cloud_ProjectKubeUpdate` is `{ name?, updatePolicy? }`), so adding or
  // removing this block on a live cluster is refused at plan time, not applied.
  network: Schema.optionalKey(MksNetwork),
  // Optional: absent means no ingress load balancer, which is today's behaviour.
  ingress: Schema.optionalKey(MksIngress)
}).check(isSecretsRequiredForObjectStorage, isAuthMethodConsistentWithProvider, isIngressPlaceable, isFlavorUnambiguous)

export type MksClusterConfig = typeof MksClusterConfig.Type
export type MksClusterConfigEncoded = typeof MksClusterConfig.Encoded
