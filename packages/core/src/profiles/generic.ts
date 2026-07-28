import { Effect, Layer } from "effect"
import { ConfigInvalid } from "../errors/tagged.ts"
import type { ClusterConfigShape } from "../domain/types.ts"
import { ProviderProfile } from "../ports/provider-profile.ts"
import { validateAutoscaling, validateCni } from "../ports/validation.ts"

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
  validate: (config: ClusterConfigShape) => _validateCrossDistro(config)
}

// kumulo: the cross-distro gates are capability checks on `config.distro`, not
// provider checks — every profile owes them. `generic` used to return
// `Effect.void`, which is how `provider: upcloud` (and any future provider
// without a bespoke profile) reached apply with `autoscaling.enabled` silently
// dropped instead of rejected (AC8). The ovh and hetzner profiles run the same
// two gates inside their own validators.
const _validateCrossDistro = (config: ClusterConfigShape): Effect.Effect<void, ConfigInvalid> => {
  const issues = [validateAutoscaling(config), validateCni(config)]
    .filter((option) => option._tag === "Some")
    .map((option) => ({ path: [], message: option.value.reason }))
  return issues.length === 0 ? Effect.void : Effect.fail(new ConfigInvalid({ issues }))
}

export const genericProfileLive = Layer.succeed(ProviderProfile, genericProfile)
