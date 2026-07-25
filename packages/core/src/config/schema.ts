import { Schema } from "effect"

// kumulo: dotted-quad CIDR check bounding octets to 0-255 and prefix to 0-32
// (format + range only, no reachability/route checks — out of scope for schema)
const octet = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)"
const prefix = "(3[0-2]|[12]?\\d)"
const isCidr = Schema.isPattern(new RegExp(`^${octet}\\.${octet}\\.${octet}\\.${octet}/${prefix}$`), {
  message: "must be a CIDR in a.b.c.d/n form with valid octets (0-255) and prefix (0-32)"
})

const Cidr = Schema.String.check(isCidr)

const isOddCount = Schema.makeFilter((count: number) =>
  count >= 1 && count % 2 === 1 ? undefined : "must be 1 or an odd number (embedded etcd quorum)"
)

const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const Provider = Schema.Literals(["ovh", "generic", "hetzner"])
const Distro = Schema.Literals(["k3s", "ovh-mks"])
const PublicAccess = Schema.Literals(["bastionless", "nat"])
const AuthMethod = Schema.Literals(["application_credential", "clouds_yaml", "env", "api_token"])
const DnsModule = Schema.Literals(["ovh", "designate", "none", "hetzner"])
const VolumesModule = Schema.Literals(["cinder", "hcloud", "none"])
const ObjectStorageModule = Schema.Literals(["ovh", "none"])
const SecretsSink = Schema.Literals(["sops", "none"])
const Cni = Schema.Literals(["flannel", "cilium"])
const AccessMode = Schema.Literals(["ReadWriteOnce", "ReadWriteMany", "ReadOnlyMany"])

const k3sVersionPattern = /^v\d+\.\d+\.\d+\+k3s\d+$/
const plainK8sVersionPattern = /^v?\d+\.\d+\.\d+$/

// kumulo: version format is distro-dependent — k3s embeds a
// `+k3sN` build suffix, ovh-mks uses plain upstream Kubernetes versions.
const isVersionValidForDistro = Schema.makeFilter((config: { distro: string; version: string }) => {
  const pattern = config.distro === "k3s" ? k3sVersionPattern : plainK8sVersionPattern
  return pattern.test(config.version) ? undefined : "version does not match the format expected for this distro"
})

// kumulo: object storage buckets carry secrets, so an ovh module requires a real sink
const isSecretsRequiredForObjectStorage = Schema.makeFilter(
  (config: { object_storage: { module: string }; secrets: { sink: string } }) =>
    config.object_storage.module === "ovh" && config.secrets.sink === "none"
      ? "secrets.sink must not be none when object_storage.module is ovh"
      : undefined
)

// kumulo: hetzner uses a static hcloud API token; every other provider uses
// an OpenStack-style auth method — the two vocabularies never mix
const isAuthMethodConsistentWithProvider = Schema.makeFilter(
  (config: { provider: string; auth: { method: string } }) =>
    (config.provider === "hetzner") !== (config.auth.method === "api_token")
      ? "auth.method must be api_token if and only if provider is hetzner"
      : undefined
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
    addons: { hcloud_csi: { enabled: boolean }; cinder_csi: { enabled: boolean } }
  }) => {
    if (config.addons.hcloud_csi.enabled && config.provider !== "hetzner")
      return "addons.hcloud_csi can only be enabled when provider is hetzner"
    if (config.addons.cinder_csi.enabled && config.provider === "hetzner")
      return "addons.cinder_csi cannot be enabled when provider is hetzner"
    return undefined
  }
)

// kumulo: only the k3s path wires the OpenStack-family DNS modules; hetzner
// and none work on every distro
const isDnsModuleConsistentWithDistro = Schema.makeFilter(
  (config: { distro: string; dns: { module: string } }) =>
    (config.dns.module === "ovh" || config.dns.module === "designate") && config.distro !== "k3s"
      ? `dns.module ${config.dns.module} is only supported on distro k3s, not ${config.distro}`
      : undefined
)

const Auth = Schema.Struct({
  method: AuthMethod,
  region: Schema.NonEmptyString
})

const Network = Schema.Struct({
  cidr: Cidr,
  public_access: PublicAccess
})

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

const DnsRecord = Schema.Struct({
  name: Schema.NonEmptyString,
  target: Schema.NonEmptyString
})

const Dns = Schema.Struct({
  module: DnsModule,
  zone: Schema.NonEmptyString,
  ttl: PositiveInt,
  records: Schema.Array(DnsRecord)
})

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

const Volumes = Schema.Struct({
  module: VolumesModule,
  managed: Schema.Array(ManagedVolume)
})

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

const isBucketsEmptyWhenModuleNone = Schema.makeFilter(
  (objectStorage: { module: string; buckets: ReadonlyArray<unknown> }) =>
    objectStorage.module === "none" && objectStorage.buckets.length > 0
      ? "buckets must be empty when object_storage.module is none"
      : undefined
)

const ObjectStorage = Schema.Struct({
  module: ObjectStorageModule,
  buckets: Schema.Array(Bucket)
}).check(isBucketsEmptyWhenModuleNone)

const isAgeRecipient = Schema.isPattern(/^age1/, {
  message: "must be an age recipient key starting with age1"
})

const Sops = Schema.Struct({
  age_recipient: Schema.String.check(isAgeRecipient)
})

const isSopsConfiguredWhenSinkIsSops = Schema.makeFilter((secrets: { sink: string; sops?: unknown }) =>
  secrets.sink === "sops" && secrets.sops === undefined
    ? "sops config is required when secrets.sink is sops"
    : undefined
)

const Secrets = Schema.Struct({
  sink: SecretsSink,
  dir: Schema.NonEmptyString,
  sops: Schema.optionalKey(Sops)
}).check(isSopsConfiguredWhenSinkIsSops)

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

export const ClusterConfig = Schema.Struct({
  name: Schema.NonEmptyString,
  provider: Provider,
  distro: Distro,
  version: Schema.NonEmptyString,
  auth: Auth,
  network: Network,
  api_server: ApiServer,
  ssh: Ssh,
  masters: Masters,
  worker_pools: Schema.Array(WorkerPool),
  dns: Dns,
  volumes: Volumes,
  object_storage: ObjectStorage,
  secrets: Secrets,
  addons: Addons,
  k3s: K3sPassthrough
}).check(
  isVersionValidForDistro,
  isSecretsRequiredForObjectStorage,
  isAuthMethodConsistentWithProvider,
  isVolumesModuleConsistentWithProvider,
  isAddonsConsistentWithProvider,
  isDnsModuleConsistentWithDistro
)

export type ClusterConfig = typeof ClusterConfig.Type
export type ClusterConfigEncoded = typeof ClusterConfig.Encoded
export type WorkerPool = typeof WorkerPool.Type
