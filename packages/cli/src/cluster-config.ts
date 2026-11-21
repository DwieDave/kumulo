import { Schema } from "effect"
import {
  authMethodConsistentWithProvider,
  cdnOriginUrlRequired,
  decodeConfigWith,
  encodeConfigWith,
  parseConfigYamlWith,
  secretsRequiredForObjectStorage
} from "@kumulo/core"
import { cdnApexRequiresBunnyDns } from "@kumulo/cdn-bunny"
import { cloudflareTtlRange } from "@kumulo/dns-cloudflare"
import { godaddyApexNotCname, godaddyTtlMinimum } from "@kumulo/dns-godaddy"
import { K3sClusterConfig } from "@kumulo/distro-k3s"
import { MksClusterConfig, mksConfigRules } from "@kumulo/distro-ovh-mks"
import { UpcloudUksClusterConfig, uksConfigRules } from "@kumulo/distro-upcloud-uks"
import { hetznerCsiHasNoVolumeType, hetznerVolumesConsistentWithProvider } from "@kumulo/hetzner"

// Rules that name a specific provider live with that provider; the CLI is the only place
// that knows all of them, so they are applied to the assembled union here.
const _providerRules = [
  hetznerVolumesConsistentWithProvider,
  hetznerCsiHasNoVolumeType,
  godaddyTtlMinimum,
  godaddyApexNotCname,
  cloudflareTtlRange,
  cdnApexRequiresBunnyDns
] as const

// Every rule the document enforces, for rendering the JSON Schema's top-level allOf.
// Distro-local rules are applied inside their distro's struct and listed here for the generator only.
export const clusterConfigRules = [
  secretsRequiredForObjectStorage,
  authMethodConsistentWithProvider,
  cdnOriginUrlRequired,
  ...mksConfigRules,
  ...uksConfigRules,
  ..._providerRules
]

export const ClusterConfig = Schema.Union([K3sClusterConfig, MksClusterConfig, UpcloudUksClusterConfig]).check(
  hetznerVolumesConsistentWithProvider.filter,
  hetznerCsiHasNoVolumeType.filter,
  godaddyTtlMinimum.filter,
  godaddyApexNotCname.filter,
  cloudflareTtlRange.filter,
  cdnApexRequiresBunnyDns.filter
)

export type ClusterConfig = typeof ClusterConfig.Type

export type ClusterConfigEncoded = typeof ClusterConfig.Encoded

export const decodeConfig = decodeConfigWith(ClusterConfig)
export const encodeConfig = encodeConfigWith(ClusterConfig)
export const parseConfigYaml = parseConfigYamlWith(ClusterConfig)

export { K3sClusterConfig, MksClusterConfig, UpcloudUksClusterConfig }

export type { K3sClusterConfigEncoded } from "@kumulo/distro-k3s"

export type { MksClusterConfigEncoded } from "@kumulo/distro-ovh-mks"

export type { UpcloudUksClusterConfigEncoded } from "@kumulo/distro-upcloud-uks"
