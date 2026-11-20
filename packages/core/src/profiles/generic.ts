import { Effect, Layer, Option } from "effect"
import { ConfigInvalid } from "../errors/tagged.ts"
import type { ClusterConfigFields } from "../domain/types.ts"
import { ProviderProfile } from "../ports/provider-profile.ts"
import { validateAutoscaling, validateCni } from "../ports/validation.ts"

export const genericProfile = {
  validate: (config: ClusterConfigFields) => _validateCrossDistro(config)
}

// skipping these gates silently drops autoscaling/cni validation
const _validateCrossDistro = (config: ClusterConfigFields): Effect.Effect<void, ConfigInvalid> => {
  const issues = [validateAutoscaling(config), validateCni(config)]
    .flatMap(Option.toArray)
    .map((violation) => ({ path: [], message: violation.reason }))

  return issues.length === 0 ? Effect.void : Effect.fail(new ConfigInvalid({ issues }))
}

export const genericProfileLive = Layer.succeed(ProviderProfile, genericProfile)
