import { Schema } from "effect"

// kumulo: dotted-quad CIDR check bounding octets to 0-255 and prefix to 0-32
// (format + range only, no reachability/route checks — out of scope for schema)
const octet = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)"
const prefix = "(3[0-2]|[12]?\\d)"
const isCidr = Schema.isPattern(new RegExp(`^${octet}\\.${octet}\\.${octet}\\.${octet}/${prefix}$`), {
  message: "must be a CIDR in a.b.c.d/n form with valid octets (0-255) and prefix (0-32)"
})

const Cidr = Schema.String.check(isCidr)

// kumulo: UpCloud SDN networks must be /8-/29, and cannot overlap the ranges
// UpCloud itself reserves (carrier-grade NAT, loopback, multicast, link-local).
const _UPCLOUD_EXCLUDED_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["224.0.0.0", 4],
  ["169.254.0.0", 16]
]
const _ipToInt = (ip: string): number => ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0)
const _rangeOf = (ip: string, bits: number): readonly [number, number] => {
  const size = 2 ** (32 - bits)
  const first = Math.floor(_ipToInt(ip) / size) * size
  return [first, first + size - 1]
}
const isUpcloudCidr = Schema.makeFilter((cidr: string) => {
  const [address = "", bitsStr = "0"] = cidr.split("/")
  const bits = Number(bitsStr)
  if (bits < 8 || bits > 29) return "prefix must be between /8 and /29"
  const [first, last] = _rangeOf(address, bits)
  const overlaps = _UPCLOUD_EXCLUDED_RANGES.some(([rangeIp, rangeBits]) => {
    const [rangeFirst, rangeLast] = _rangeOf(rangeIp, rangeBits)
    return first <= rangeLast && last >= rangeFirst
  })
  return overlaps
    ? "must not overlap UpCloud's excluded ranges (100.64.0.0/10, 127.0.0.0/8, 224.0.0.0/4, 169.254.0.0/16)"
    : undefined
})
const UpcloudCidr = Cidr.check(isUpcloudCidr)

// kumulo: UpCloud node group names are lowercase/digits/hyphen, 1-63 chars,
// no leading/trailing hyphen (R20). Bounded to 54 here so D9's `-<hash8>`
// replace suffix always fits inside UpCloud's 63-char limit.
const isUpcloudPoolName = Schema.isPattern(/^[a-z0-9]([a-z0-9-]{0,52}[a-z0-9])?$/, {
  message: "must be 1-54 lowercase/digit/hyphen characters, no leading or trailing hyphen"
})
const UpcloudPoolName = Schema.String.check(isUpcloudPoolName)

const isOddCount = Schema.makeFilter((count: number) =>
  count >= 1 && count % 2 === 1 ? undefined : "must be 1 or an odd number (embedded etcd quorum)"
)

const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const Provider = Schema.Literals(["ovh", "generic", "hetzner", "upcloud"])
const PublicAccess = Schema.Literals(["bastionless", "nat"])
const AuthMethod = Schema.Literals(["application_credential", "clouds_yaml", "env", "api_token"])
const Cni = Schema.Literals(["flannel", "cilium"])
const AccessMode = Schema.Literals(["ReadWriteOnce", "ReadWriteMany", "ReadOnlyMany"])

export type Provider = typeof Provider.Type
export type AuthMethod = typeof AuthMethod.Type

// kumulo: version format is distro-dependent — k3s embeds a
// `+k3sN` build suffix, ovh-mks uses plain upstream Kubernetes versions.
// Structural so the pattern lands in the generated JSON schema.
const K3sVersion = Schema.String.check(
  Schema.isPattern(/^v\d+\.\d+\.\d+\+k3s\d+$/, { message: "must be a k3s version like v1.31.4+k3s1" })
)
const PlainK8sVersion = Schema.String.check(
  Schema.isPattern(/^v?\d+\.\d+\.\d+$/, { message: "must be a Kubernetes version like v1.31.4" })
)
// kumulo: UKS is minor-only (D7) — the cluster carries `version: "1.31"` and
// `available-upgrades` returns the same minor-only vocabulary. No patch
// component ever leaves the config file.
const UksVersion = Schema.String.check(
  Schema.isPattern(/^v?\d+\.\d+$/, { message: "must be a minor-only Kubernetes version like 1.31" })
)

// kumulo: object storage buckets carry secrets, so an ovh module requires a real sink
const isSecretsRequiredForObjectStorage = Schema.makeFilter(
  (config: { object_storage: { module: string }; secrets: { sink: string } }) =>
    config.object_storage.module === "ovh" && config.secrets.sink === "none"
      ? "secrets.sink must not be none when object_storage.module is ovh"
      : undefined
)

// kumulo: hetzner and upcloud each use a static API token; ovh and generic
// use an OpenStack-style auth method — the two vocabularies never mix (D5).
export const authMethodsByProvider: Record<Provider, ReadonlyArray<AuthMethod>> = {
  hetzner: ["api_token"],
  upcloud: ["api_token"],
  ovh: ["application_credential", "clouds_yaml", "env"],
  generic: ["application_credential", "clouds_yaml", "env"]
}

const isAuthMethodConsistentWithProvider = Schema.makeFilter(
  (config: { provider: Provider; auth: { method: AuthMethod } }) =>
    authMethodsByProvider[config.provider].includes(config.auth.method)
      ? undefined
      : `auth.method must be one of ${authMethodsByProvider[config.provider].join(", ")} for provider ${config.provider}`
)

// kumulo: hcloud volumes only exist on hetzner; cinder volumes only exist on
// the OpenStack-family providers — cross-wiring either is a config error
const isVolumesModuleConsistentWithProvider = Schema.makeFilter(
  (config: { provider: string; volumes: { module: string } }) => {
    if (config.volumes.module === "hcloud" && config.provider !== "hetzner")
      return "volumes.module hcloud requires provider hetzner"
    if (config.volumes.module === "cinder" && config.provider === "hetzner")
      return "volumes.module cinder is not available on provider hetzner"
    return undefined
  }
)

// kumulo: hcloud_csi/cinder_csi are provider-specific addons — enabling the
// wrong one for the active provider is a config error, not a silent no-op
const isAddonsConsistentWithProvider = Schema.makeFilter(
  (config: {
    provider: string
    addons?: { hcloud_csi: { enabled: boolean }; cinder_csi: { enabled: boolean } }
  }) => {
    if (config.addons === undefined) return undefined
    if (config.addons.hcloud_csi.enabled && config.provider !== "hetzner")
      return "addons.hcloud_csi can only be enabled when provider is hetzner"
    if (config.addons.cinder_csi.enabled && config.provider === "hetzner")
      return "addons.cinder_csi cannot be enabled when provider is hetzner"
    return undefined
  }
)

const Auth = Schema.Struct({
  method: AuthMethod,
  region: Schema.NonEmptyString
})

const Network = Schema.Struct({
  cidr: Cidr,
  public_access: PublicAccess
})

// kumulo: an IPv4 CIDR as the inclusive [first, last] address range it covers,
// with the host bits masked off (`10.0.1.5/16` is the same range as `10.0.0.0/16`)
const _cidrRange = (cidr: string): readonly [number, number] => {
  const [address = "", bits = "0"] = cidr.split("/")
  const size = 2 ** (32 - Number(bits))
  const first = Math.floor(address.split(".").reduce((acc, part) => acc * 256 + Number(part), 0) / size) * size
  return [first, first + size - 1]
}

// kumulo: `cidr` is the network's declared address space and nothing downstream
// reads it — Neutron only ever sees the two subnet CIDRs. Unchecked it is a
// required field that does nothing, and a subnet outside the network an
// operator believes they declared would decode clean.
const _SUBNET_FIELDS = ["nodes_subnet", "load_balancers_subnet"] as const
const isSubnetsWithinCidr = Schema.makeFilter(
  (network: { cidr: string; nodes_subnet: string; load_balancers_subnet: string }) => {
    const [first, last] = _cidrRange(network.cidr)
    const outside = _SUBNET_FIELDS.filter((field) => {
      const [start, end] = _cidrRange(network[field])
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

// kumulo: kumulo owns the network for UKS (D10) — it creates the SDN network
// and its router, and tears both down after the cluster on delete. Unlike
// MksNetwork there is no separate subnets split (UpCloud's SDN network is
// itself the one CIDR nodes and the control plane share).
const UpcloudNetwork = Schema.Struct({
  cidr: UpcloudCidr
})

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

const ApiServer = Schema.Struct({
  high_availability: Schema.Boolean,
  allowed_cidrs: Schema.Array(Cidr)
})

const Ssh = Schema.Struct({
  public_key_path: Schema.NonEmptyString,
  allowed_cidrs: Schema.Array(Cidr)
})

const Masters = Schema.Struct({
  flavor: Schema.NonEmptyString,
  count: Schema.Number.check(Schema.isInt()).check(isOddCount),
  image: Schema.NonEmptyString
})

const Autoscaling = Schema.Struct({
  enabled: Schema.Boolean,
  min: NonNegativeInt,
  max: PositiveInt
})

const WorkerPool = Schema.Struct({
  name: Schema.NonEmptyString,
  flavor: Schema.NonEmptyString,
  count: NonNegativeInt,
  labels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  taints: Schema.optionalKey(Schema.Array(Schema.String)),
  autoscaling: Schema.optionalKey(Autoscaling)
})

// kumulo: same shape as WorkerPool, but `name` is bounded by UpCloud's node
// group naming rules (R20) rather than the generic NonEmptyString. The
// `autoscaling` block stays accepted-but-runtime-rejected (AC8): UKS has no
// autoscaler, scaling is `count` drift the way D8 already handles it.
const UpcloudWorkerPool = Schema.Struct({
  name: UpcloudPoolName,
  flavor: Schema.NonEmptyString,
  count: NonNegativeInt,
  labels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  taints: Schema.optionalKey(Schema.Array(Schema.String)),
  autoscaling: Schema.optionalKey(Autoscaling)
})

const DnsRecord = Schema.Struct({
  name: Schema.NonEmptyString,
  target: Schema.NonEmptyString
})

// kumulo: zone/ttl/records only mean something for a real dns module, so
// `module: none` is its own variant instead of demanding dead fields.
const Dns = Schema.Union([
  Schema.Struct({ module: Schema.Literal("none") }),
  Schema.Struct({
    module: Schema.Literals(["ovh", "hetzner"]),
    zone: Schema.NonEmptyString,
    ttl: PositiveInt,
    records: Schema.Array(DnsRecord)
  })
])

const Pvc = Schema.Struct({
  namespace: Schema.NonEmptyString,
  access_modes: Schema.Array(AccessMode)
})

const ManagedVolume = Schema.Struct({
  name: Schema.NonEmptyString,
  size_gb: PositiveInt,
  type: Schema.NonEmptyString,
  retain: Schema.Boolean,
  pvc: Schema.optionalKey(Pvc)
})

const NoVolumes = Schema.Struct({ module: Schema.Literal("none") })
const CinderVolumes = Schema.Struct({
  module: Schema.Literal("cinder"),
  managed: Schema.Array(ManagedVolume)
})
const HcloudVolumes = Schema.Struct({
  module: Schema.Literal("hcloud"),
  managed: Schema.Array(ManagedVolume)
})
const Volumes = Schema.Union([NoVolumes, CinderVolumes, HcloudVolumes])
// kumulo: the mks variant fixes provider to ovh, so hcloud is not expressible
const OpenStackVolumes = Schema.Union([NoVolumes, CinderVolumes])

// kumulo: S3 bucket naming rules — 3-63 chars, lowercase alphanumeric/dots/hyphens,
// must start and end with an alphanumeric character
const isS3BucketName = Schema.isPattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, {
  message: "must be 3-63 chars, lowercase alphanumeric/dots/hyphens, and start/end alphanumeric"
})

const BucketName = Schema.String.check(isS3BucketName)

const Bucket = Schema.Struct({
  name: BucketName,
  // Required on purpose: OVH's S3 regions ("DE", "GRA", ...) are a different
  // namespace than compute regions ("DE1", ...), so defaulting from
  // auth.region would manufacture 404s.
  region: Schema.NonEmptyString,
  versioning: Schema.Boolean,
  encryption: Schema.Boolean,
  retain: Schema.Boolean
})

const ObjectStorage = Schema.Union([
  Schema.Struct({ module: Schema.Literal("none") }),
  Schema.Struct({
    module: Schema.Literal("ovh"),
    buckets: Schema.Array(Bucket)
  })
])

const isAgeRecipient = Schema.isPattern(/^age1/, {
  message: "must be an age recipient key starting with age1"
})

const Sops = Schema.Struct({
  age_recipient: Schema.String.check(isAgeRecipient)
})

const Secrets = Schema.Union([
  Schema.Struct({ sink: Schema.Literal("none") }),
  Schema.Struct({
    sink: Schema.Literal("sops"),
    dir: Schema.NonEmptyString,
    sops: Sops
  })
])

const CinderCsi = Schema.Struct({
  enabled: Schema.Boolean,
  default_volume_type: Schema.NonEmptyString
})

const HcloudCsi = Schema.Struct({
  enabled: Schema.Boolean
})

const Addons = Schema.Struct({
  cloud_controller_manager: Schema.Boolean,
  cinder_csi: CinderCsi,
  hcloud_csi: HcloudCsi,
  system_upgrade_controller: Schema.Boolean,
  cni: Cni
})

const K3sPassthrough = Schema.Struct({
  extra_server_args: Schema.Array(Schema.String),
  extra_agent_args: Schema.Array(Schema.String)
})

export const OutputsFormat = Schema.Literals(["yaml", "json"])
export type OutputsFormat = typeof OutputsFormat.Type

// Format of the files kumulo itself writes next to the config
// (`<cluster>.outputs.*`, `<cluster>.buckets.*`). Defaults to yaml.
const Outputs = Schema.Struct({
  format: OutputsFormat
})

// Fields every distro carries; the variants below add their distro-specific
// blocks so `distro` narrows a decoded config to exactly what that path needs.
const _commonFields = {
  name: Schema.NonEmptyString,
  outputs: Schema.optionalKey(Outputs),
  auth: Auth,
  worker_pools: Schema.Array(WorkerPool),
  volumes: Volumes,
  object_storage: ObjectStorage,
  secrets: Secrets
}

export const K3sClusterConfig = Schema.Struct({
  ..._commonFields,
  provider: Provider,
  distro: Schema.Literal("k3s"),
  version: K3sVersion,
  dns: Dns,
  // Required: the k3s path provisions its own control plane, network and nodes.
  network: Network,
  api_server: ApiServer,
  ssh: Ssh,
  masters: Masters,
  addons: Addons,
  k3s: K3sPassthrough
}).check(
  isSecretsRequiredForObjectStorage,
  isAuthMethodConsistentWithProvider,
  isVolumesModuleConsistentWithProvider,
  isAddonsConsistentWithProvider
)

// MKS's control plane, networking and node access are OVH-managed, so the
// k3s-only blocks are absent and provider is fixed to ovh — which structurally
// subsumes the addons and volumes gates (no addons block, cinder|none only);
// the auth gate still bites, since `api_token` stays expressible.
export const MksClusterConfig = Schema.Struct({
  ..._commonFields,
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

// kumulo: creation-time fields only (D11) — `zone`, `plan`,
// `control_plane_ip_filter` and `storage_encryption` can never change on a
// live cluster (D8/AC6), so they are plain fields here and drift on them is
// refused at plan time by clusterDrift (M4), not encoded in the schema.
// `upgrade_strategy` is deliberately not named `strategy` — the CLI verb
// already has one (D11). `volumes` is fixed to `none`: UKS has no managed
// cinder/hcloud volume story in this cut (R15).
export const UpgradeStrategy = Schema.Literals(["manual", "rolling-update"])

export const UpcloudUksClusterConfig = Schema.Struct({
  ..._commonFields,
  provider: Schema.Literal("upcloud"),
  distro: Schema.Literal("upcloud-uks"),
  version: UksVersion,
  zone: Schema.NonEmptyString,
  // Optional: absent means UpCloud's own default (`dev-md`).
  plan: Schema.optionalKey(Schema.NonEmptyString),
  network: UpcloudNetwork,
  worker_pools: Schema.Array(UpcloudWorkerPool),
  dns: Dns,
  volumes: NoVolumes,
  control_plane_ip_filter: Schema.optionalKey(Schema.Array(Cidr)),
  storage_encryption: Schema.optionalKey(Schema.Boolean),
  upgrade_strategy: Schema.optionalKey(UpgradeStrategy)
}).check(isSecretsRequiredForObjectStorage, isAuthMethodConsistentWithProvider)

export const ClusterConfig = Schema.Union([K3sClusterConfig, MksClusterConfig, UpcloudUksClusterConfig])

export type K3sClusterConfig = typeof K3sClusterConfig.Type
export type K3sClusterConfigEncoded = typeof K3sClusterConfig.Encoded
export type MksClusterConfig = typeof MksClusterConfig.Type
export type MksClusterConfigEncoded = typeof MksClusterConfig.Encoded
export type UpcloudUksClusterConfig = typeof UpcloudUksClusterConfig.Type
export type UpcloudUksClusterConfigEncoded = typeof UpcloudUksClusterConfig.Encoded
export type ClusterConfig = typeof ClusterConfig.Type
export type ClusterConfigEncoded = typeof ClusterConfig.Encoded
export type WorkerPool = typeof WorkerPool.Type
