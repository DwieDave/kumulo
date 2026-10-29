import { Layer } from "effect"
import { ProviderProfile } from "@kumulo/core"
import { validateHetznerConfig } from "./validation.ts"

// always-true pending per-location verification, revisit if Hetzner ships a location without LB
const _hasLoadBalancer = (_location: string): boolean => true

export const makeHetznerProfile = () => ({
  name: "hetzner",
  auth: {
    keystoneUrlPattern: "",
    domainDefault: ""
  },
  capabilities: {
    octavia: _hasLoadBalancer,
    floatingIps: false,
    volumeTypes: ["default"]
  },
  defaults: {
    externalNetworkName: "",
    imageAliases: {},
    dnsServers: ["185.12.64.1", "185.12.64.2"]
  },
  validate: validateHetznerConfig
})

export const hetznerProfileLive = Layer.succeed(ProviderProfile, makeHetznerProfile())
