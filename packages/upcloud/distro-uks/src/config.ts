import { Schema } from "effect"
import {
  BucketName,
  Cidr,
  commonClusterFields,
  Dns,
  isAuthMethodConsistentWithProvider,
  isCdnApexRequiresBunnyDns,
  isGodaddyApexNotCname,
  isGodaddyTtlMinimum,
  isCdnOriginUrlRequired,
  isSecretsRequiredForObjectStorage,
  NonNegativeInt,
  NoVolumes,
  ObjectStorage,
  PositiveInt,
  Pvc,
  Autoscaling
} from "@kumulo/core"

// UpCloud SDN networks must be /8-/29 and cannot overlap UpCloud's reserved ranges (CGNAT, loopback, multicast, link-local).
const _UPCLOUD_EXCLUDED_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["224.0.0.0", 4],
  ["169.254.0.0", 16]
]

export const UKS_RESERVED_RANGES = {
  controlPlane: "172.31.240.0/24",
  services: "10.128.0.0/12",
  pods: "192.168.0.0/16",
  forwarder: "10.33.128.0/22"
} as const

const _RESERVED_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["control plane CIDR", UKS_RESERVED_RANGES.controlPlane],
  ["service CIDR", UKS_RESERVED_RANGES.services],
  ["POD CIDR", UKS_RESERVED_RANGES.pods],
  ["forwarder CIDR", UKS_RESERVED_RANGES.forwarder]
]

// https://upcloud.com/docs/products/managed-kubernetes/data-plane/
export const UKS_UTILITY_RANGES = {
  "fi-hel1": "10.1.0.0/16",
  "uk-lon1": "10.2.0.0/16",
  "us-chi1": "10.3.0.0/16",
  "de-fra1": "10.4.0.0/16",
  "nl-ams1": "10.5.0.0/16",
  "fi-hel2": "10.6.0.0/16",
  "es-mad1": "10.7.0.0/16",
  "us-sjo1": "10.8.0.0/16",
  "us-nyc1": "10.9.0.0/16",
  "sg-sin1": "10.10.0.0/16",
  "pl-waw1": "10.11.0.0/16",
  "au-syd1": "10.12.0.0/16",
  "se-sto1": "10.13.0.0/16",
  "dk-cph1": "10.14.0.0/16",
  "no-svg1": "10.15.0.0/16"
} as const satisfies Record<string, string>

const _ipToInt = (ip: string): number => ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0)

const _rangeOf = (ip: string, bits: number): readonly [number, number] => {
  const size = 2 ** (32 - bits)
  const first = Math.floor(_ipToInt(ip) / size) * size

  return [first, first + size - 1]
}

const _parseCidr = (cidr: string): readonly [number, number] => {
  const [address = "", bitsStr = "0"] = cidr.split("/")

  return _rangeOf(address, Number(bitsStr))
}

const _overlaps = (cidr: string, other: string): boolean => {
  const [first, last] = _parseCidr(cidr)
  const [otherFirst, otherLast] = _parseCidr(other)

  return first <= otherLast && last >= otherFirst
}

const isUpcloudCidr = Schema.makeFilter((cidr: string) => {
  const bits = Number(cidr.split("/")[1] ?? "0")

  if (bits < 8 || bits > 29) return "prefix must be between /8 and /29"

  if (_UPCLOUD_EXCLUDED_RANGES.some(([rangeIp, rangeBits]) => _overlaps(cidr, `${rangeIp}/${rangeBits}`))) {
    return "must not overlap UpCloud's excluded ranges (100.64.0.0/10, 127.0.0.0/8, 224.0.0.0/4, 169.254.0.0/16)"
  }

  const reserved = _RESERVED_LABELS.find(([, range]) => _overlaps(cidr, range))

  return reserved ? `must not overlap the UKS ${reserved[0]} ${reserved[1]}` : undefined
})

const isOutsideZoneUtilityRange = Schema.makeFilter(
  ({ zone, network }: { readonly zone: string; readonly network: { readonly cidr: string } }) => {
    const utility = Object.entries(UKS_UTILITY_RANGES).find(([name]) => name === zone)?.[1]

    return utility !== undefined && _overlaps(network.cidr, utility)
      ? { path: ["network", "cidr"], issue: `must not overlap the ${zone} utility network ${utility}` }
      : undefined
  }
)

const UpcloudCidr = Cidr.check(isUpcloudCidr)

const isUpcloudPoolName = Schema.isPattern(/^[a-z0-9]([a-z0-9-]{0,52}[a-z0-9])?$/, {
  message: "must be 1-54 lowercase/digit/hyphen characters, no leading or trailing hyphen"
})

const UpcloudPoolName = Schema.String.check(isUpcloudPoolName)

const UksClusterName = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{1,53}[a-z0-9]$/, {
    message: "must be 3-55 lowercase letters, digits or hyphens, with no leading or trailing hyphen"
  })
)

const UksVersion = Schema.String.check(
  Schema.isPattern(/^\d+\.\d+$/, { message: "must be a minor-only Kubernetes version like 1.31" })
)

const UpcloudNetwork = Schema.Struct({
  cidr: UpcloudCidr
})

export const UksTaint = Schema.String.check(
  Schema.isPattern(/^[^=:\s]{1,255}(=[^:\s]{0,255})?(:(NoSchedule|PreferNoSchedule|NoExecute))?$/, {
    message: "must look like key[=value][:NoSchedule|PreferNoSchedule|NoExecute]"
  })
)

const UksPoolLabels = Schema.Record(Schema.String, Schema.String).check(
  Schema.makeFilter((labels: Readonly<Record<string, string>>) =>
    Object.keys(labels).some((key) => key.startsWith("kumulo-")) ? "kumulo- label keys are reserved" : undefined
  )
)

const UpcloudWorkerPool = Schema.Struct({
  name: UpcloudPoolName,
  flavor: Schema.NonEmptyString,
  count: NonNegativeInt,
  labels: Schema.optionalKey(UksPoolLabels),
  taints: Schema.optionalKey(Schema.Array(UksTaint)),
  autoscaling: Schema.optionalKey(Autoscaling)
})

export const UpcloudVolumeTier = Schema.Literals(["maxiops", "standard", "hdd"])

export type UpcloudVolumeTier = typeof UpcloudVolumeTier.Type

const UpcloudManagedVolume = Schema.Struct({
  name: Schema.NonEmptyString,
  size_gb: PositiveInt,
  type: UpcloudVolumeTier,
  retain: Schema.Boolean,
  pvc: Schema.optionalKey(Pvc)
})

const UpcloudVolumes = Schema.Struct({
  module: Schema.Literal("upcloud"),
  managed: Schema.Array(UpcloudManagedVolume)
})

const UpcloudBucket = Schema.Struct({
  name: BucketName,
  retain: Schema.Boolean
})

const UpcloudObjectStorage = Schema.Struct({
  module: Schema.Literal("upcloud"),
  region: Schema.NonEmptyString,
  buckets: Schema.Array(UpcloudBucket)
})

const UksObjectStorage = Schema.Union([...ObjectStorage.members, UpcloudObjectStorage])

export const UpgradeStrategy = Schema.Literals(["manual", "rolling-update"])

export type UpgradeStrategy = typeof UpgradeStrategy.Type

// zone, plan, control_plane_ip_filter, storage_encryption are creation-time only; drift on them is refused at plan time, not encoded in the schema.
export const UpcloudUksClusterConfig = Schema.Struct({
  ...commonClusterFields,
  name: UksClusterName,
  provider: Schema.Literal("upcloud"),
  distro: Schema.Literal("upcloud-uks"),
  version: UksVersion,
  zone: Schema.NonEmptyString,
  plan: Schema.optionalKey(Schema.NonEmptyString),
  network: UpcloudNetwork,
  worker_pools: Schema.Array(UpcloudWorkerPool),
  dns: Dns,
  volumes: Schema.Union([NoVolumes, UpcloudVolumes]),
  object_storage: UksObjectStorage,
  control_plane_ip_filter: Schema.optionalKey(
    Schema.Array(Cidr).check(
      Schema.isMinLength(1, {
        message:
          'must not be empty: [] denies all access to the control plane; omit the field to leave the filter unmanaged, or use ["0.0.0.0/0"] to allow all'
      })
    )
  ),
  storage_encryption: Schema.optionalKey(Schema.Boolean),
  upgrade_strategy: Schema.optionalKey(UpgradeStrategy)
}).check(
  isOutsideZoneUtilityRange,
  isSecretsRequiredForObjectStorage,
  isAuthMethodConsistentWithProvider,
  isCdnApexRequiresBunnyDns,
  isCdnOriginUrlRequired,
  isGodaddyTtlMinimum,
  isGodaddyApexNotCname
)

export type UpcloudUksClusterConfig = typeof UpcloudUksClusterConfig.Type

export type UpcloudUksClusterConfigEncoded = typeof UpcloudUksClusterConfig.Encoded
