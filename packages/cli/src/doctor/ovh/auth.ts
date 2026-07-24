import { Effect } from "effect"
import type { DoctorCheck } from "../types.ts"
import type { OvhProjectClient } from "./probe.ts"
import { probeStatus } from "./probe.ts"

const _name = "ovh-auth-validity"

/** OVH auth validity: a 401 on any authenticated call means bad/expired credentials. */
export const authValidityCheck = (args: {
  readonly mks: OvhProjectClient
  readonly serviceName: string
}): DoctorCheck => ({
  name: _name,
  run: probeStatus(args).pipe(
    Effect.map((status) =>
      status === "unauthenticated"
        ? { name: _name, status: "fail" as const, message: "OVH credentials are invalid or expired — check OVH_CLIENT_ID/OVH_CLIENT_SECRET." }
        : { name: _name, status: "pass" as const, message: "OVH credentials accepted." }
    )
  )
})
