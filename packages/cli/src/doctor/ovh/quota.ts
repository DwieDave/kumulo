import { Effect } from "effect"
import type { DoctorCheck } from "../types.ts"
import type { OvhProjectClient } from "./probe.ts"

const _name = "ovh-plan-vs-quota"

// maxClusters is caller-supplied: no OVH quota endpoint exists yet to read it live.
export const planVsQuotaCheck = (args: {
  readonly mks: OvhProjectClient
  readonly serviceName: string
  readonly plannedClusterCount: number
  readonly maxClusters: number
}): DoctorCheck => ({
  name: _name,
  run: args.mks.getCloudProjectServiceNameKube(args.serviceName).pipe(
    Effect.match({
      onSuccess: (existing) => _result(args, existing.length + args.plannedClusterCount),
      onFailure: () => ({
        name: _name,
        status: "fail" as const,
        message: `Could not read existing MKS clusters in project "${args.serviceName}" to preview quota headroom.`
      })
    })
  )
})

const _result = (
  args: { readonly serviceName: string; readonly plannedClusterCount: number; readonly maxClusters: number },
  total: number
) =>
  total > args.maxClusters
    ? {
      name: _name,
      status: "fail" as const,
      message:
        `Plan needs ${total} MKS clusters in project "${args.serviceName}" (existing + planned), exceeding the quota of ${args.maxClusters}.`
    }
    : {
      name: _name,
      status: "pass" as const,
      message: `Quota headroom OK: ${total}/${args.maxClusters} MKS clusters after this plan.`
    }
