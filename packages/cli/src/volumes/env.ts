import { Effect, Layer } from "effect"
import { AuthenticationFailed } from "@kumulo/core"
import { CinderAuth } from "@kumulo/volumes-cinder"
import type { CinderAuthError } from "@kumulo/volumes-cinder"
import type { OpenStackError } from "@kumulo/openstack"
import { OpenStackEnv } from "../doctor-openstack/env.ts"

const _toCinderAuthError = (cause: OpenStackError): CinderAuthError =>
  cause._tag === "CapabilityMissing" || cause._tag === "ProvisioningTimeout"
    ? new AuthenticationFailed({ hint: `keystone: ${cause._tag}` })
    : cause

// Layer never fails at build time; missing/broken OpenStack env surfaces only when a volumes op calls .token/.endpoint.
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
