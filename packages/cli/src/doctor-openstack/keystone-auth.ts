import type { AuthenticationFailed } from "@kumulo/core"
import { Effect } from "effect"
import type { DoctorCheck } from "../doctor/types.ts"

const _name = "openstack-keystone-auth"

/** Keystone auth: a failed token issue means bad/missing OpenStack credentials. */
export const keystoneAuthCheck = (args: {
  readonly token: Effect.Effect<string, AuthenticationFailed>
}): DoctorCheck => ({
  name: _name,
  run: args.token.pipe(
    Effect.match({
      onFailure: (error) => ({
        name: _name,
        status: "fail" as const,
        message: `OpenStack authentication failed: ${error.hint} — check OS_* env vars or clouds.yaml.`
      }),
      onSuccess: () => ({ name: _name, status: "pass" as const, message: "OpenStack (Keystone) credentials accepted." })
    })
  )
})
