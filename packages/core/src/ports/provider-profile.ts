import type { Effect } from "effect";
import { Context } from "effect"
import type { ConfigInvalid } from "../errors/tagged.ts"
import type { ClusterConfigFields } from "../domain/types.ts"

export type ProfileError = ConfigInvalid

// Per-provider config validation; never makes HTTP calls itself.
export class ProviderProfile extends Context.Service<ProviderProfile, {
  readonly validate: (config: ClusterConfigFields) => Effect.Effect<void, ProfileError>
}>()("@kumulo/core/ProviderProfile") {}
