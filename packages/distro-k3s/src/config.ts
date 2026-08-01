/**
 * The k3s cluster-config variant. Shared building blocks come from
 * `@kumulo/core`; everything only k3s carries (self-managed control plane,
 * ssh, masters, addons, k3s passthrough) is defined here. The `ClusterConfig`
 * union over all variants is assembled in `@kumulo/cli`.
 */
import { Schema } from "effect"
import {
  Cidr,
  commonClusterFields,
  Dns,
  isAuthMethodConsistentWithProvider,
  isSecretsRequiredForObjectStorage,
  isVolumesModuleConsistentWithProvider,
  ProviderSchema
} from "@kumulo/core"

const isOddCount = Schema.makeFilter((count: number) =>
  count >= 1 && count % 2 === 1 ? undefined : "must be 1 or an odd number (embedded etcd quorum)"
)

const PublicAccess = Schema.Literals(["bastionless", "nat"])
const Cni = Schema.Literals(["flannel", "cilium"])

// kumulo: version format is distro-dependent — k3s embeds a `+k3sN` build
// suffix. Structural so the pattern lands in the generated JSON schema.
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

export const K3sClusterConfig = Schema.Struct({
  ...commonClusterFields,
  provider: ProviderSchema,
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

export type K3sClusterConfig = typeof K3sClusterConfig.Type
export type K3sClusterConfigEncoded = typeof K3sClusterConfig.Encoded
