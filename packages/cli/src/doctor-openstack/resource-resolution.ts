import type { CloudError } from "@kumulo/core"
import { Effect } from "effect"
import type { DoctorCheck } from "../doctor/types.ts"

/** Image/flavor resolution: fail loudly here rather than mid-`create`. Shared by both kinds (DRY). */
export const resourceResolutionCheck = (args: {
  readonly kind: "image" | "flavor"
  readonly ref: string
  readonly resolve: Effect.Effect<string, CloudError>
}): DoctorCheck => {
  const name = `openstack-${args.kind}-resolution`
  return {
    name,
    run: args.resolve.pipe(
      Effect.match({
        onFailure: () => ({
          name,
          status: "fail" as const,
          message: `Could not resolve ${args.kind} "${args.ref}" in this project/region — check the ref or its alias in the config.`
        }),
        onSuccess: (id) => ({ name, status: "pass" as const, message: `${args.kind} "${args.ref}" resolved to ${id}.` })
      })
    )
  }
}
