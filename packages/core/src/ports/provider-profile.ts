import type { Effect } from "effect";
import { Context } from "effect"
import type { ConfigInvalid } from "../errors/tagged.ts"
import type { ClusterConfigShape } from "../domain/types.ts"

export type ProfileError = ConfigInvalid

export interface AuthDefaults {
  readonly keystoneUrlPattern: string
  readonly domainDefault: string
}

// Data + small logic parameterizing the OpenStack
// implementation; never makes HTTP calls itself.
export class ProviderProfile extends Context.Service<ProviderProfile, {
  readonly name: string
  readonly auth: AuthDefaults
  readonly capabilities: {
    readonly octavia: (region: string) => boolean
    readonly floatingIps: boolean
    readonly volumeTypes: ReadonlyArray<string>
  }
  readonly defaults: {
    readonly externalNetworkName: string
    readonly imageAliases: Record<string, string>
    readonly dnsServers: ReadonlyArray<string>
  }
  readonly validate: (config: ClusterConfigShape) => Effect.Effect<void, ProfileError>
}>()("@kumulo/core/ProviderProfile") {}
