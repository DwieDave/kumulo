import { Effect } from "effect"
import type { DoctorCheck } from "../types.ts"
import type { OvhProjectClient } from "./probe.ts"
import { probeStatus } from "./probe.ts"

const _name = "ovh-project-access"

/** FR-10.2 — project access: a 403 means valid credentials without rights on this project. */
export const projectAccessCheck = (args: {
  readonly mks: OvhProjectClient
  readonly serviceName: string
}): DoctorCheck => ({
  name: _name,
  run: probeStatus(args).pipe(
    Effect.map((status) => {
      if (status === "forbidden") {
        return {
          name: _name,
          status: "fail" as const,
          message: `No access to OVH project "${args.serviceName}" — check the API application's project scope.`
        }
      }
      if (status === "unauthenticated") {
        return {
          name: _name,
          status: "fail" as const,
          message: "Cannot verify project access: authentication failed (see ovh-auth-validity)."
        }
      }
      return { name: _name, status: "pass" as const, message: `Project "${args.serviceName}" is reachable.` }
    })
  )
})
