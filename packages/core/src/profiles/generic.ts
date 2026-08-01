import { Effect, Layer } from "effect"
import { ConfigInvalid } from "../errors/tagged.ts"
import type { ClusterConfigShape } from "../domain/types.ts"
import { ProviderProfile } from "../ports/provider-profile.ts"
import { validateAutoscaling, validateCni } from "../ports/validation.ts"

export const genericProfile = {
  name: "generic",
  auth: {
    keystoneUrlPattern: "",
    domainDefault: "Default"
  },
  capabilities: {
    octavia: (_region: string) => true,
    floatingIps: true,
    volumeTypes: []
  },
  defaults: {
    externalNetworkName: "",
    imageAliases: {},
    dnsServers: []
  },
  validate: (config: ClusterConfigShape) => _validateCrossDistro(config)
}

// skipping these gates silently drops autoscaling/cni validation
const _validateCrossDistro = (config: ClusterConfigShape): Effect.Effect<void, ConfigInvalid> => {
  const issues = [validateAutoscaling(config), validateCni(config)]
    .filter((option) => option._tag === "Some")
    .map((option) => ({ path: [], message: option.value.reason }))
  return issues.length === 0 ? Effect.void : Effect.fail(new ConfigInvalid({ issues }))
}

export const genericProfileLive = Layer.succeed(ProviderProfile, genericProfile)
