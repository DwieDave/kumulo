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

const GatewayModel = Schema.Literals(["s", "m", "l", "xl", "2xl", "3xl"])

const MksNetwork = Schema.Struct({
  cidr: Cidr,
  nodes_subnet: Cidr,
  load_balancers_subnet: Cidr,
  gateway_model: Schema.optionalKey(GatewayModel)
}).check(isSubnetsWithinCidr)

// no proxy-protocol/timeout fields, those are pool settings owned by the cloud-controller-manager
const MksIngress = Schema.Struct({
  flavor_id: Schema.optionalKey(Schema.NonEmptyString),
  flavor: Schema.optionalKey(Schema.NonEmptyString)
})

const isFlavorUnambiguous = Schema.makeFilter((config: { ingress?: { flavor?: unknown; flavor_id?: unknown } }) =>
  config.ingress?.flavor !== undefined && config.ingress?.flavor_id !== undefined
    ? "ingress.flavor and ingress.flavor_id both set: use the name (MKS Free) or the id (MKS Standard), not both"
    : undefined
)

const isIngressPlaceable = Schema.makeFilter((config: { network?: unknown; ingress?: unknown }) =>
  config.ingress !== undefined && config.network === undefined
    ? "ingress requires a network block: the load balancer's VIP must sit on the cluster's load_balancers_subnet"
    : undefined
)

export const MksClusterConfig = Schema.Struct({
  ...commonClusterFields,
  provider: Schema.Literal("ovh"),
  distro: Schema.Literal("ovh-mks"),
  version: PlainK8sVersion,
  dns: Dns,
  volumes: OpenStackVolumes,
  // landmine: network is create-time-only, adding/removing it on a live cluster is refused at plan time
  network: Schema.optionalKey(MksNetwork),
  ingress: Schema.optionalKey(MksIngress)
}).check(isSecretsRequiredForObjectStorage, isAuthMethodConsistentWithProvider, isIngressPlaceable, isFlavorUnambiguous)

export type MksClusterConfig = typeof MksClusterConfig.Type
export type MksClusterConfigEncoded = typeof MksClusterConfig.Encoded
