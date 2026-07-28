import { Layer } from "effect"
import { ProviderProfile } from "@kumulo/core"
import { imageAliasesForRegion } from "./image-aliases.ts"
import { hasOctavia } from "./regions.ts"
import { validateOvhConfig } from "./validation.ts"

// kumulo: OVH `ProviderProfile`: Ext-Net is the floating-IP *pool*, not an
// alternative to floating IPs — a public Octavia LB is reached through a
// floating IP allocated from Ext-Net and associated with the LB's VIP port,
// which is what `ensureFloatingIp` does. Per-region Octavia + image aliases,
// OVH's three Cinder volume types.
// Region is fixed at construction time (known once `auth.region` is
// decoded from config), which is how the flat `imageAliases`/`octavia`
// port shapes still carry per-region data.
export const makeOvhProfile = (region: string) => ({
  name: "ovh",
  auth: {
    keystoneUrlPattern: "https://auth.cloud.ovh.net/v3",
    domainDefault: "Default"
  },
  capabilities: {
    octavia: hasOctavia,
    floatingIps: true,
    volumeTypes: ["classic", "high-speed", "high-speed-gen2"]
  },
  defaults: {
    externalNetworkName: "Ext-Net",
    imageAliases: imageAliasesForRegion(region),
    dnsServers: ["213.186.33.99"]
  },
  validate: validateOvhConfig
})

export const ovhProfileLive = (region: string) => Layer.succeed(ProviderProfile, makeOvhProfile(region))
