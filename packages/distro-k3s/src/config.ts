import { Schema } from "effect"
import {
  Cidr,
  commonClusterFields,
  Dns,
  isAuthMethodConsistentWithProvider,
  isCdnApexRequiresBunnyDns,
  isGodaddyApexNotCname,
  isGodaddyTtlMinimum,
  isCdnOriginUrlRequired,
  isSecretsRequiredForObjectStorage,
  isVolumesModuleConsistentWithProvider,
  ProviderSchema
} from "@kumulo/core"

const isOddCount = Schema.makeFilter((count: number) =>
  count >= 1 && count % 2 === 1 ? undefined : "must be 1 or an odd number (embedded etcd quorum)"
)

const PublicAccess = Schema.Literals(["bastionless", "nat"])
const Cni = Schema.Literals(["flannel", "cilium"])

const K3sVersion = Schema.String.check(
  Schema.isPattern(/^v\d+\.\d+\.\d+\+k3s\d+$/, { message: "must be a k3s version like v1.31.4+k3s1" })
)

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

const Csi = Schema.Struct({
  enabled: Schema.Boolean,
  default_volume_type: Schema.optionalKey(Schema.NonEmptyString)
})

// pre-csi configs lack this key, so the missing-key error doubles as the migration hint
const LEGACY_CSI_MESSAGE = "addons.csi is required: it replaced addons.cinder_csi and addons.hcloud_csi"

const Addons = Schema.Struct({
  cloud_controller_manager: Schema.Boolean,
  csi: Csi.pipe(Schema.annotateKey({ messageMissingKey: LEGACY_CSI_MESSAGE })),
  system_upgrade_controller: Schema.Boolean,
  cni: Cni
})

const K3sPassthrough = Schema.Struct({
  extra_server_args: Schema.Array(Schema.String),
  extra_agent_args: Schema.Array(Schema.String)
})

const isCsiVolumeTypeSupportedByProvider = Schema.makeFilter(
  (config: { provider: string; addons?: { csi: { default_volume_type?: string | undefined } } }) =>
    config.provider === "hetzner" && config.addons?.csi.default_volume_type !== undefined
      ? "addons.csi.default_volume_type is not supported when provider is hetzner (Hetzner volumes have no types)"
      : undefined
)

export const K3sClusterConfig = Schema.Struct({
  ...commonClusterFields,
  provider: ProviderSchema,
  distro: Schema.Literal("k3s"),
  version: K3sVersion,
  dns: Dns,
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
  isCsiVolumeTypeSupportedByProvider,
  isCdnApexRequiresBunnyDns,
  isCdnOriginUrlRequired,
  isGodaddyTtlMinimum,
  isGodaddyApexNotCname
)

export type K3sClusterConfig = typeof K3sClusterConfig.Type

export type K3sClusterConfigEncoded = typeof K3sClusterConfig.Encoded
