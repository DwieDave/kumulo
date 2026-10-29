import { Layer } from "effect"
import { ProviderProfile } from "@kumulo/core"
import { imageAliasesForRegion } from "./image-aliases.ts"
import { hasOctavia } from "./regions.ts"
import { validateOvhConfig } from "./validation.ts"

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
