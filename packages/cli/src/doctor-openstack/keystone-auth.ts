import type { OpenStackError } from "@kumulo/openstack"
import { Effect } from "effect"
import type { DoctorCheck } from "../doctor/types.ts"

const _name = "openstack-keystone-auth"

// Keystone can fail for more than bad credentials (rate limit, 5xx, decode);
// only `AuthenticationFailed` carries a hint, the rest report their tag.
const _hint = (error: OpenStackError): string => "hint" in error ? error.hint : error._tag

/** Keystone auth: a failed token issue means bad/missing OpenStack credentials. */
export const keystoneAuthCheck = (args: {
  readonly token: Effect.Effect<string, OpenStackError>
}): DoctorCheck => ({
  name: _name,
  run: args.token.pipe(
    Effect.match({
      onFailure: (error) => ({
        name: _name,
        status: "fail" as const,
        message: `OpenStack authentication failed: ${_hint(error)} — check OS_* env vars or clouds.yaml.`
      }),
      onSuccess: () => ({ name: _name, status: "pass" as const, message: "OpenStack (Keystone) credentials accepted." })
    })
  )
})
