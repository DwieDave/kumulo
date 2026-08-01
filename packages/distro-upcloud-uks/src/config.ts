import { Schema } from "effect"
import {
  BucketName,
  Cidr,
  commonClusterFields,
  Dns,
  isAuthMethodConsistentWithProvider,
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

const isUpcloudPoolName = Schema.isPattern(/^[a-z0-9]([a-z0-9-]{0,52}[a-z0-9])?$/, {
  message: "must be 1-54 lowercase/digit/hyphen characters, no leading or trailing hyphen"
})
const UpcloudPoolName = Schema.String.check(isUpcloudPoolName)

const UksVersion = Schema.String.check(
  Schema.isPattern(/^v?\d+\.\d+$/, { message: "must be a minor-only Kubernetes version like 1.31" })
)

const UpcloudNetwork = Schema.Struct({
  cidr: UpcloudCidr
})

const UpcloudWorkerPool = Schema.Struct({
  name: UpcloudPoolName,
  flavor: Schema.NonEmptyString,
  count: NonNegativeInt,
  labels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  taints: Schema.optionalKey(Schema.Array(Schema.String)),
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
  control_plane_ip_filter: Schema.optionalKey(Schema.Array(Cidr)),
  storage_encryption: Schema.optionalKey(Schema.Boolean),
  upgrade_strategy: Schema.optionalKey(UpgradeStrategy)
}).check(isSecretsRequiredForObjectStorage, isAuthMethodConsistentWithProvider)

export type UpcloudUksClusterConfig = typeof UpcloudUksClusterConfig.Type
export type UpcloudUksClusterConfigEncoded = typeof UpcloudUksClusterConfig.Encoded
