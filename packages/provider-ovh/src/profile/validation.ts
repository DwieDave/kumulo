import { Effect } from "effect"
import { ConfigInvalid, validateAutoscaling, validateCni } from "@kumulo/core"
import type { ClusterConfigShape } from "@kumulo/core"
import { hasOctavia } from "./regions.ts"

const ovhVolumeTypes: ReadonlyArray<string> = ["classic", "high-speed", "high-speed-gen2"]

// FR-1.4 example case: HA control plane needs a load balancer, and OVH's
// LB (Octavia) isn't available in every region — no fallback exists, so
// reject rather than silently provisioning a non-HA endpoint.
const _octaviaIssue = (config: ClusterConfigShape): string | undefined =>
  config.api_server?.high_availability === true && !hasOctavia(config.auth?.region ?? "")
    ? `region '${config.auth?.region}' has no Octavia (load balancer) support; ` +
      `high_availability requires a load balancer and there is no fallback`
    : undefined

const _volumeTypeIssue = (config: ClusterConfigShape): string | undefined => {
  const unsupported = config.volumes?.retained.find((vol) => !ovhVolumeTypes.includes(vol.type))
  return unsupported === undefined
    ? undefined
    : `volume type '${unsupported.type}' is not one of the OVH volume types: ${ovhVolumeTypes.join(", ")}`
}

export const validateOvhConfig = (config: ClusterConfigShape): Effect.Effect<void, ConfigInvalid> => {
  const messages = [_octaviaIssue(config), _volumeTypeIssue(config)].filter((m) => m !== undefined)
  const crossDistro = [validateAutoscaling(config), validateCni(config)]
    .filter((o) => o._tag === "Some")
    .map((o) => o.value.reason)
  const allMessages = [...messages, ...crossDistro]
  return allMessages.length === 0
    ? Effect.void
    : Effect.fail(new ConfigInvalid({ issues: allMessages.map((message) => ({ path: [], message })) }))
}
