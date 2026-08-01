/**
 * The upcloud-uks cluster-config variant. Shared building blocks come from
 * `@kumulo/core`; everything UpCloud/UKS-specific (SDN CIDR rules, node-group
 * naming, tiered volumes, region-scoped object storage) is defined here. The
 * `ClusterConfig` union over all variants is assembled in `@kumulo/cli`.
 */
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

// kumulo: UKS is minor-only (D7) — the cluster carries `version: "1.31"` and
// `available-upgrades` returns the same minor-only vocabulary. No patch
// component ever leaves the config file.
const UksVersion = Schema.String.check(
  Schema.isPattern(/^v?\d+\.\d+$/, { message: "must be a minor-only Kubernetes version like 1.31" })
)

// kumulo: kumulo owns the network for UKS (D10) — it creates the SDN network
// and its router, and tears both down after the cluster on delete. Unlike
// MksNetwork there is no separate subnets split (UpCloud's SDN network is
// itself the one CIDR nodes and the control plane share).
const UpcloudNetwork = Schema.Struct({
  cidr: UpcloudCidr
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

// kumulo: UpCloud's storage tiers are a closed set (D5) — unlike cinder's
// free-form volume types — and tier is immutable at the API, so a type
// change is replace-only drift, refused at plan time.
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

// kumulo: UpCloud buckets are bare names — the v2 API's bucket create body is
// `{"name"}` only, so versioning/encryption flags are not expressible. The
// service instance is region-scoped (D8), so `region` sits at module level,
// not per bucket like OVH's.
const UpcloudBucket = Schema.Struct({
  name: BucketName,
  retain: Schema.Boolean
})

const UpcloudObjectStorage = Schema.Struct({
  module: Schema.Literal("upcloud"),
  region: Schema.NonEmptyString,
  buckets: Schema.Array(UpcloudBucket)
})

// kumulo: the upcloud module is only expressible on the UKS variant (D10's
// analogue for buckets) — the service rides the cluster's SDN network.
const UksObjectStorage = Schema.Union([...ObjectStorage.members, UpcloudObjectStorage])

export const UpgradeStrategy = Schema.Literals(["manual", "rolling-update"])
export type UpgradeStrategy = typeof UpgradeStrategy.Type

// kumulo: creation-time fields only (D11) — `zone`, `plan`,
// `control_plane_ip_filter` and `storage_encryption` can never change on a
// live cluster (D8/AC6), so they are plain fields here and drift on them is
// refused at plan time by clusterDrift (M4), not encoded in the schema.
// `upgrade_strategy` is deliberately not named `strategy` — the CLI verb
// already has one (D11). Volumes: `none` or upcloud block storage (this
// workflow's M1); cinder/hcloud stay inexpressible.
export const UpcloudUksClusterConfig = Schema.Struct({
  ...commonClusterFields,
  provider: Schema.Literal("upcloud"),
  distro: Schema.Literal("upcloud-uks"),
  version: UksVersion,
  zone: Schema.NonEmptyString,
  // Optional: absent means UpCloud's own default (`dev-md`).
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
