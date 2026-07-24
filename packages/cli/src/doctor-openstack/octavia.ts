import { Effect } from "effect"
import type { DoctorCheck } from "../doctor/types.ts"

const _name = "openstack-octavia-capability"

/**
 * Per-region Octavia (load balancer) capability. `supported` comes
 * from the active `ProviderProfile.capabilities.octavia(region)` — a pure
 * lookup, no network call needed here.
 */
export const octaviaCapabilityCheck = (args: { readonly region: string; readonly supported: boolean }): DoctorCheck => ({
  name: _name,
  run: Effect.succeed(
    args.supported
      ? { name: _name, status: "pass" as const, message: `Octavia (load balancer) is available in ${args.region}.` }
      : {
        name: _name,
        status: "fail" as const,
        message:
          `Octavia is not available in ${args.region} — a plan requiring a load balancer here needs a different region, or drop high_availability's LB requirement.`
      }
  )
})
