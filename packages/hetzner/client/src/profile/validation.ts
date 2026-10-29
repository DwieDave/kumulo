import { Effect, Option } from "effect"
import { ConfigInvalid, validateAutoscaling, validateCni } from "@kumulo/core"
import type { ClusterConfigFields } from "@kumulo/core"
import { hetznerLocations, isHetznerLocation } from "./locations.ts"

// kumulo: `auth.region` is Hetzner's location (D8 — no dedicated field); an
// unrecognized location has no network zone to derive (D2) and every hcloud
// call built from it would 404, so reject before any resource is touched (R9's
// "loud, before apply" bar applies here too).
const _locationIssue = (config: ClusterConfigFields): string | undefined => {
  const location = config.auth?.region ?? ""

  return isHetznerLocation(location)
    ? undefined
    : `location '${location}' is not one of the Hetzner locations: ${hetznerLocations.join(", ")}`
}

export const validateHetznerConfig = (config: ClusterConfigFields): Effect.Effect<void, ConfigInvalid> => {
  const messages = [_locationIssue(config)].flatMap((m) => m === undefined ? [] : [m])

  const crossDistro = [validateAutoscaling(config), validateCni(config)]
    .flatMap((o) => Option.isSome(o) ? [o.value.reason] : [])

  const allMessages = [...messages, ...crossDistro]

  return allMessages.length === 0
    ? Effect.void
    : Effect.fail(new ConfigInvalid({ issues: allMessages.map((message) => ({ path: [], message })) }))
}
