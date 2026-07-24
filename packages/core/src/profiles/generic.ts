import { Effect, Layer } from "effect"
import type { ClusterConfigShape } from "../domain/types.ts"
import { ProviderProfile } from "../ports/provider-profile.ts"

// `generic` ships in core for vanilla OpenStack clouds
// (clouds.yaml-driven, no assumptions). No capability restrictions, no
// image/network defaults to guess at; users set what OVH gives away free.
export const genericProfile = {
  name: "generic",
  auth: {
    keystoneUrlPattern: "", // clouds.yaml/env supply the real auth_url
    domainDefault: "Default"
  },
  capabilities: {
    octavia: (_region: string) => true,
    floatingIps: true,
    volumeTypes: [] // kumulo: empty = no restriction, generic makes no assumptions
  },
  defaults: {
    externalNetworkName: "",
    imageAliases: {},
    dnsServers: []
  },
  validate: (_config: ClusterConfigShape) => Effect.void
}

export const genericProfileLive = Layer.succeed(ProviderProfile, genericProfile)
