/**
 * Shared config building blocks. Distro-specific variants live in their
 * distro packages (`@kumulo/distro-k3s`, `@kumulo/distro-ovh-mks`,
 * `@kumulo/distro-upcloud-uks`); the `ClusterConfig` union is assembled in
 * `@kumulo/cli`, the only layer that knows every distro. Core only owns what
 * more than one distro shares: primitives, the common field set, and the
 * provider-level cross-field rules.
 */
import { Schema } from "effect"

// kumulo: dotted-quad CIDR check bounding octets to 0-255 and prefix to 0-32
// (format + range only, no reachability/route checks — out of scope for schema)
const octet = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)"
const prefix = "(3[0-2]|[12]?\\d)"
const isCidr = Schema.isPattern(new RegExp(`^${octet}\\.${octet}\\.${octet}\\.${octet}/${prefix}$`), {
  message: "must be a CIDR in a.b.c.d/n form with valid octets (0-255) and prefix (0-32)"
})

export const Cidr = Schema.String.check(isCidr)

// kumulo: an IPv4 CIDR as the inclusive [first, last] address range it covers,
// with the host bits masked off (`10.0.1.5/16` is the same range as `10.0.0.0/16`)
export const cidrRange = (cidr: string): readonly [number, number] => {
  const [address = "", bits = "0"] = cidr.split("/")
  const size = 2 ** (32 - Number(bits))
  const first = Math.floor(address.split(".").reduce((acc, part) => acc * 256 + Number(part), 0) / size) * size
  return [first, first + size - 1]
}

export const PositiveInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))
export const NonNegativeInt = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const Provider = Schema.Literals(["ovh", "generic", "hetzner", "upcloud"])
export const AuthMethod = Schema.Literals(["application_credential", "clouds_yaml", "env", "api_token"])
export const AccessMode = Schema.Literals(["ReadWriteOnce", "ReadWriteMany", "ReadOnlyMany"])

export type Provider = typeof Provider.Type
export type AuthMethod = typeof AuthMethod.Type

// kumulo: object storage buckets carry secrets, so ANY real module requires a
// real sink — the rule predates upcloud and used to name ovh alone.
export const isSecretsRequiredForObjectStorage = Schema.makeFilter(
  (config: { object_storage: { module: string }; secrets: { sink: string } }) =>
    config.object_storage.module !== "none" && config.secrets.sink === "none"
      ? `secrets.sink must not be none when object_storage.module is ${config.object_storage.module}`
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

export const isAuthMethodConsistentWithProvider = Schema.makeFilter(
  (config: { provider: Provider; auth: { method: AuthMethod } }) =>
    authMethodsByProvider[config.provider].includes(config.auth.method)
      ? undefined
      : `auth.method must be one of ${authMethodsByProvider[config.provider].join(", ")} for provider ${config.provider}`
)

// kumulo: hcloud volumes only exist on hetzner; cinder volumes only exist on
// the OpenStack-family providers — cross-wiring either is a config error
export const isVolumesModuleConsistentWithProvider = Schema.makeFilter(
  (config: { provider: string; volumes: { module: string } }) => {
    if (config.volumes.module === "hcloud" && config.provider !== "hetzner")
      return "volumes.module hcloud requires provider hetzner"
    if (config.volumes.module === "cinder" && config.provider === "hetzner")
      return "volumes.module cinder is not available on provider hetzner"
    return undefined
  }
)

export const Auth = Schema.Struct({
  method: AuthMethod,
  region: Schema.NonEmptyString
})

export const Autoscaling = Schema.Struct({
  enabled: Schema.Boolean,
  min: NonNegativeInt,
  max: PositiveInt
})

export const WorkerPool = Schema.Struct({
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

// kumulo: zone/ttl/records only mean something for a real dns module, so
// `module: none` is its own variant instead of demanding dead fields.
export const Dns = Schema.Union([
  Schema.Struct({ module: Schema.Literal("none") }),
  Schema.Struct({
    module: Schema.Literals(["ovh", "hetzner"]),
    zone: Schema.NonEmptyString,
    ttl: PositiveInt,
    records: Schema.Array(DnsRecord)
  })
])

export const Pvc = Schema.Struct({
  namespace: Schema.NonEmptyString,
  access_modes: Schema.Array(AccessMode)
})

export const ManagedVolume = Schema.Struct({
  name: Schema.NonEmptyString,
  size_gb: PositiveInt,
  type: Schema.NonEmptyString,
  retain: Schema.Boolean,
  pvc: Schema.optionalKey(Pvc)
})

export const NoVolumes = Schema.Struct({ module: Schema.Literal("none") })
export const CinderVolumes = Schema.Struct({
  module: Schema.Literal("cinder"),
  managed: Schema.Array(ManagedVolume)
})
export const HcloudVolumes = Schema.Struct({
  module: Schema.Literal("hcloud"),
  managed: Schema.Array(ManagedVolume)
})
export const Volumes = Schema.Union([NoVolumes, CinderVolumes, HcloudVolumes])
// kumulo: the mks variant fixes provider to ovh, so hcloud is not expressible
export const OpenStackVolumes = Schema.Union([NoVolumes, CinderVolumes])

// kumulo: S3 bucket naming rules — 3-63 chars, lowercase alphanumeric/dots/hyphens,
// must start and end with an alphanumeric character
const isS3BucketName = Schema.isPattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, {
  message: "must be 3-63 chars, lowercase alphanumeric/dots/hyphens, and start/end alphanumeric"
})

export const BucketName = Schema.String.check(isS3BucketName)

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

export const ObjectStorage = Schema.Union([
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

export const Secrets = Schema.Union([
  Schema.Struct({ sink: Schema.Literal("none") }),
  Schema.Struct({
    sink: Schema.Literal("sops"),
    dir: Schema.NonEmptyString,
    sops: Sops
  })
])

export const OutputsFormat = Schema.Literals(["yaml", "json"])
export type OutputsFormat = typeof OutputsFormat.Type

// Format of the files kumulo itself writes next to the config
// (`<cluster>.outputs.*`, `<cluster>.buckets.*`). Defaults to yaml.
export const Outputs = Schema.Struct({
  format: OutputsFormat
})

// Fields every distro carries; the distro variants spread these and add their
// distro-specific blocks so `distro` narrows a decoded config to exactly what
// that path needs.
export const commonClusterFields = {
  name: Schema.NonEmptyString,
  outputs: Schema.optionalKey(Outputs),
  auth: Auth,
  worker_pools: Schema.Array(WorkerPool),
  volumes: Volumes,
  object_storage: ObjectStorage,
  secrets: Secrets
}

export type WorkerPool = typeof WorkerPool.Type
