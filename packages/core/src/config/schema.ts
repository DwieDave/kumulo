import { Schema } from "effect"

// kumulo: basic dotted-quad CIDR check (format only, no reachability/route checks — out of scope for schema)
const isCidr = Schema.isPattern(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/, {
  message: "must be a CIDR in a.b.c.d/n form"
})

const Cidr = Schema.String.check(isCidr)

const isOddCount = Schema.makeFilter((count: number) =>
  count >= 1 && count % 2 === 1 ? undefined : "must be 1 or an odd number (embedded etcd quorum)"
)

const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const Provider = Schema.Literals(["ovh", "generic"])
const Distro = Schema.Literals(["k3s", "ovh-mks"])
const PublicAccess = Schema.Literals(["bastionless", "nat"])
const AuthMethod = Schema.Literals(["application_credential", "clouds_yaml", "env"])
const DnsModule = Schema.Literals(["ovh", "designate", "none"])
const VolumesModule = Schema.Literals(["cinder", "none"])
const Cni = Schema.Literals(["flannel", "cilium"])
const AccessMode = Schema.Literals(["ReadWriteOnce", "ReadWriteMany", "ReadOnlyMany"])

const K3sVersion = Schema.String.check(
  Schema.isPattern(/^v\d+\.\d+\.\d+\+k3s\d+$/, { message: "must look like v1.31.4+k3s1" })
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

const RetainedVolume = Schema.Struct({
  name: Schema.NonEmptyString,
  size_gb: PositiveInt,
  type: Schema.NonEmptyString,
  retain: Schema.Boolean,
  pvc: Schema.optionalKey(Pvc)
})

const Volumes = Schema.Struct({
  module: VolumesModule,
  retained: Schema.Array(RetainedVolume)
})

const CinderCsi = Schema.Struct({
  enabled: Schema.Boolean,
  default_volume_type: Schema.NonEmptyString
})

const Addons = Schema.Struct({
  cloud_controller_manager: Schema.Boolean,
  cinder_csi: CinderCsi,
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
  version: K3sVersion,
  auth: Auth,
  network: Network,
  api_server: ApiServer,
  ssh: Ssh,
  masters: Masters,
  worker_pools: Schema.Array(WorkerPool),
  dns: Dns,
  volumes: Volumes,
  addons: Addons,
  k3s: K3sPassthrough
})

export type ClusterConfig = typeof ClusterConfig.Type
export type ClusterConfigEncoded = typeof ClusterConfig.Encoded
export type WorkerPool = typeof WorkerPool.Type
