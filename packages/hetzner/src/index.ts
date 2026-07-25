export const packageName = "@kumulo/hetzner"

export { HCLOUD_API_BASE_URL, hcloudHttpClientLive } from "./auth/client.ts"

export { hetznerLocationZones, hetznerLocations, isHetznerLocation, networkZoneForLocation } from "./profile/locations.ts"
export { hetznerProfileLive, makeHetznerProfile } from "./profile/hetzner.ts"
export { validateHetznerConfig } from "./profile/validation.ts"

export { buildHcloudFirewallRules, HcloudFirewallRuleInput } from "./provider/firewall-rules.ts"
export {
  CloudProviderLive,
  deleteByTag,
  deleteServer,
  ensureLoadBalancer,
  ensureNetwork,
  ensurePlacementGroup,
  ensureSecurityGroups,
  ensureServer,
  listClusterResources,
  resolveFlavor,
  resolveImage
} from "./provider/cloud-provider.ts"
export type { CloudProviderOptions, ServerGroupRole } from "./provider/cloud-provider.ts"

export { HCLOUD_MIN_VOLUME_SIZE_GB, enforceMinimumVolumeSize } from "./volume/sizing.ts"
export { staticPvcManifest, staticPvManifest, staticVolumeManifests } from "./volume/manifests.ts"
export type { PvcBinding } from "./volume/manifests.ts"
export { deleteVolume, ensureVolume, listClusterVolumes, VolumeProviderLive } from "./volume/provider.ts"
export type { VolumeProviderOptions } from "./volume/provider.ts"
