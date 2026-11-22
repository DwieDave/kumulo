import { Effect, Schema } from "effect"
import { crossFieldRule } from "./rule.ts"

const octet = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)"
const prefix = "(3[0-2]|[12]?\\d)"

const isCidr = Schema.isPattern(new RegExp(`^${octet}\\.${octet}\\.${octet}\\.${octet}/${prefix}$`), {
  message: "must be a CIDR in a.b.c.d/n form with valid octets (0-255) and prefix (0-32)"
})

export const Cidr = Schema.String.check(isCidr)

const _ipv4Literal = new RegExp(`^${octet}\\.${octet}\\.${octet}\\.${octet}$`)
const _ipv6Literal = /^(?!.*:::)(?=(?:[^:]*:){2})(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/

export const isIpLiteral = (target: string): boolean => _ipv4Literal.test(target) || _ipv6Literal.test(target)

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

export const authMethodsByProvider: Record<Provider, ReadonlyArray<AuthMethod>> = {
  hetzner: ["api_token"],
  upcloud: ["api_token"],
  ovh: ["application_credential", "clouds_yaml", "env"],
  generic: ["application_credential", "clouds_yaml", "env"]
}

// kumulo: any real object_storage.module requires a real secrets.sink
export const secretsRequiredForObjectStorage = crossFieldRule({
  check: (config: { object_storage: { module: string }; secrets: { sink: string } }) =>
    config.object_storage.module !== "none" && config.secrets.sink === "none"
      ? `secrets.sink must not be none when object_storage.module is ${config.object_storage.module}`
      : undefined,
  jsonSchema: [
    {
      if: {
        properties: { object_storage: { properties: { module: { not: { const: "none" } } }, required: ["module"] } },
        required: ["object_storage"]
      },
      then: { properties: { secrets: { properties: { sink: { not: { const: "none" } } } } } }
    }
  ]
})

export const authMethodConsistentWithProvider = crossFieldRule({
  check: (config: { provider: Provider; auth: { method: AuthMethod } }) =>
    authMethodsByProvider[config.provider].includes(config.auth.method)
      ? undefined
      : `auth.method must be one of ${authMethodsByProvider[config.provider].join(", ")} for provider ${config.provider}`,
  jsonSchema: Object.entries(authMethodsByProvider).map(([provider, methods]) => ({
    if: { properties: { provider: { const: provider } }, required: ["provider"] },
    then: { properties: { auth: { properties: { method: { enum: [...methods] } } } } }
  }))
})

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

export const Dns = Schema.Union([
  // kumulo writes nothing for none; zone only fills in the names apply suggests for the records to enter by hand
  Schema.Struct({ module: Schema.Literal("none"), zone: Schema.optionalKey(Schema.NonEmptyString) }),
  Schema.Struct({
    module: Schema.Literals(["ovh", "hetzner", "bunny", "godaddy", "cloudflare"]),
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
export const OpenStackVolumes = Schema.Union([NoVolumes, CinderVolumes])

const isS3BucketName = Schema.isPattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, {
  message: "must be 3-63 chars, lowercase alphanumeric/dots/hyphens, and start/end alphanumeric"
})

export const BucketName = Schema.String.check(isS3BucketName)

const Bucket = Schema.Struct({
  name: BucketName,
  // required: OVH S3 regions are a different namespace than compute regions, defaulting from auth.region would manufacture 404s
  region: Schema.NonEmptyString,
  versioning: Schema.Boolean,
  encryption: Schema.Boolean,
  retain: Schema.Boolean
})

export const BunnyStorageRegion = Schema.Literals(["DE", "NY", "SG", "UK", "SE", "LA", "JH", "SYD"])

const isBunnyBucketName = Schema.isPattern(/^[A-Za-z0-9-]{4,}$/, {
  message: "must be at least 4 characters: letters, digits and dashes"
})

export const BunnyBucketName = Schema.String.check(isBunnyBucketName)

const BunnyBucket = Schema.Struct({
  name: BunnyBucketName,
  region: BunnyStorageRegion,
  tier: Schema.optionalKey(Schema.Literals(["standard", "edge"])),
  retain: Schema.Boolean
})

export const BunnyObjectStorage = Schema.Struct({
  module: Schema.Literal("bunny"),
  buckets: Schema.Array(BunnyBucket)
})

export const ObjectStorage = Schema.Union([
  Schema.Struct({ module: Schema.Literal("none") }),
  Schema.Struct({
    module: Schema.Literal("ovh"),
    buckets: Schema.Array(Bucket)
  }),
  BunnyObjectStorage
])

const isHostname = Schema.isPattern(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, {
  message: "must be a lowercase DNS hostname such as app.example.com"
})

const CdnHostname = Schema.String.check(isHostname)

const isCdnName = Schema.isPattern(/^[A-Za-z0-9]+$/, { message: "must contain letters and digits only" })

const ShieldPlan = Schema.Literals(["basic", "advanced", "business", "enterprise"])
const ShieldMode = Schema.Literals(["log", "block"])

const RateLimit = Schema.Struct({
  name: Schema.NonEmptyString,
  path_prefix: Schema.NonEmptyString,
  requests: PositiveInt,
  window: PositiveInt,
  block_for: PositiveInt,
  key: Schema.Literals(["ip"])
})

const AccessList = Schema.Struct({
  name: Schema.NonEmptyString,
  type: Schema.Literals(["cidr", "ip", "asn", "country"]),
  action: Schema.Literals(["allow", "block", "challenge", "log"]),
  entries: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1))
})

const _isUniqueNames = (label: string) =>
  Schema.makeFilter((items: ReadonlyArray<{ name: string }>) =>
    new Set(items.map((item) => item.name)).size === items.length ? undefined : `${label} names must be unique`
  )

export const Shield = Schema.Struct({
  plan: ShieldPlan,
  waf: Schema.Struct({ enabled: Schema.Boolean, mode: ShieldMode }),
  ddos: Schema.Struct({ sensitivity: Schema.Literals(["off", "low", "medium", "high", "challenge"]) }),
  bot_detection: Schema.Struct({ mode: ShieldMode, sensitivity: Schema.Literals(["low", "medium", "high"]) }),
  rate_limits: Schema.Array(RateLimit).check(_isUniqueNames("shield rate_limits")),
  access_lists: Schema.Array(AccessList).check(_isUniqueNames("shield access_lists"))
})

export const CdnOrigin = Schema.Union([Schema.Literal("ingress"), Schema.Struct({ url: Schema.NonEmptyString })])

export const BunnyCdn = Schema.Struct({
  module: Schema.Literal("bunny"),
  name: Schema.String.check(isCdnName),
  tier: Schema.Literals(["standard", "volume"]).pipe(Schema.withDecodingDefaultKey(Effect.succeed("standard" as const))),
  origin: CdnOrigin,
  verify_origin_tls: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  websockets: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  cache: Schema.Literals(["smart", "origin"]).pipe(Schema.withDecodingDefaultKey(Effect.succeed("smart" as const))),
  hostnames: Schema.Array(CdnHostname).check(Schema.isMinLength(1), Schema.isMaxLength(10), Schema.isUnique()),
  force_ssl: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
  shield: Schema.optionalKey(Shield)
})

export const Cdn = Schema.Union([Schema.Struct({ module: Schema.Literal("none") }), BunnyCdn])

export const cdnOriginUrlRequired = crossFieldRule({
  check: (config: { cdn?: { module: string; origin?: unknown } }) =>
    config.cdn?.origin === "ingress" ? "cdn.origin ingress is only valid for distro ovh-mks with an ingress block" : undefined,
  jsonSchema: [
    {
      if: {
        properties: { cdn: { properties: { origin: { const: "ingress" } }, required: ["origin"] } },
        required: ["cdn"]
      },
      then: { properties: { distro: { const: "ovh-mks" } } }
    }
  ]
})

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

export const Outputs = Schema.Struct({
  format: OutputsFormat
})

// DNS label: the cluster name is used in file paths, so "../" and "/" must not decode
const isClusterName = Schema.isPattern(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, {
  message: "must be a DNS label: 1-63 lowercase letters, digits or '-', starting and ending alphanumeric"
})

export const ClusterName = Schema.String.check(isClusterName)

export const commonClusterFields = {
  name: ClusterName,
  outputs: Schema.optionalKey(Outputs),
  auth: Auth,
  worker_pools: Schema.Array(WorkerPool),
  volumes: Volumes,
  object_storage: ObjectStorage,
  secrets: Secrets,
  cdn: Schema.optionalKey(Cdn)
}

export type WorkerPool = typeof WorkerPool.Type
