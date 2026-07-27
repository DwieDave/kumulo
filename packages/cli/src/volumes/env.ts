import { Effect, Layer } from "effect"
import { AuthenticationFailed } from "@kumulo/core"
import { CinderAuth } from "@kumulo/volumes-cinder"
import type { CinderAuthError } from "@kumulo/volumes-cinder"
import type { OpenStackError } from "@kumulo/openstack"
import { OpenStackEnv } from "../doctor-openstack/env.ts"

// `CinderAuthError` already covers every tag Keystone raises except these
// two, which have no volumes-side meaning — only they lose their tag.
const _toCinderAuthError = (cause: OpenStackError): CinderAuthError =>
  cause._tag === "CapabilityMissing" || cause._tag === "ProvisioningTimeout"
    ? new AuthenticationFailed({ hint: `keystone: ${cause._tag}` })
    : cause

/**
 * `CinderAuth` built from the already-resolved OpenStack Keystone auth
 * (`OpenStackEnv`, shared with the doctor checks) — Cinder is a plain
 * OpenStack service under the same project, no separate credential set.
 * Mirrors `OpenStackEnv`'s "never-failing at Layer-build time" contract: a
 * missing/broken OpenStack env only surfaces once a volumes operation
 * actually calls `.token`/`.endpoint`.
 */
export const CinderAuthLive: Layer.Layer<CinderAuth, never, OpenStackEnv> = Layer.effect(
  CinderAuth,
  Effect.gen(function*() {
    const env = yield* OpenStackEnv
    const hint = env.unavailableReason ?? "OpenStack auth unavailable"
    if (env.keystone === undefined || env.region === undefined) {
      return { token: Effect.fail(new AuthenticationFailed({ hint })), endpoint: Effect.fail(new AuthenticationFailed({ hint })) }
    }
    const { keystone, region } = env
    return {
      token: keystone.token.pipe(Effect.mapError(_toCinderAuthError)),
      endpoint: keystone.endpoint({ service: "volumev3", region }).pipe(Effect.mapError(_toCinderAuthError))
    }
  })
)
