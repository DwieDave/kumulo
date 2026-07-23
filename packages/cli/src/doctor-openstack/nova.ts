import type { AuthenticationFailed, ResourceNotFound } from "@kumulo/core"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { DoctorCheck } from "../doctor/types.ts"

// design §4.3 — pinned to the generated client's spec version (v2.96); sent
// explicitly on every Nova request rather than relying on "latest".
export const NOVA_MICROVERSION = "2.96"

export type MicroversionStatus = "accepted" | "rejected" | "unreachable"

/**
 * The one `KeystoneAuth` method this file needs, narrowed to avoid pulling
 * in the full service shape (same rationale as `doctor/ovh/probe.ts`'s
 * `OvhProjectClient`) — the real `KeystoneAuth.endpoint` satisfies this
 * structurally.
 */
export interface OpenStackEndpointResolver {
  readonly endpoint: (
    options: { readonly service: string; readonly region: string }
  ) => Effect.Effect<string, ResourceNotFound | AuthenticationFailed>
}

/** Raw `GET /v2.1/` with the pinned microversion header — Nova answers 406 when it rejects the pin. */
export const probeMicroversion = (args: {
  readonly client: HttpClient.HttpClient
  readonly keystone: OpenStackEndpointResolver
  readonly region: string
  readonly microversion: string
}): Effect.Effect<MicroversionStatus> =>
  args.keystone.endpoint({ service: "compute", region: args.region }).pipe(
    Effect.flatMap((base) =>
      args.client.execute(
        HttpClientRequest.setHeader(
          HttpClientRequest.get(new URL("v2.1/", base).toString()),
          "X-OpenStack-Nova-API-Version",
          args.microversion
        )
      )
    ),
    Effect.map((response): MicroversionStatus => {
      if (response.status === 406) return "rejected"
      return response.status >= 200 && response.status < 300 ? "accepted" : "unreachable"
    }),
    Effect.orElseSucceed((): MicroversionStatus => "unreachable")
  )

const _name = "openstack-nova-microversion"

/** FR-10.2 — microversion acceptance: fail loudly here, not mid-`create`, if the pin isn't supported. */
export const microversionCheck = (args: {
  readonly probe: Effect.Effect<MicroversionStatus>
  readonly microversion: string
}): DoctorCheck => ({
  name: _name,
  run: args.probe.pipe(
    Effect.map((status) => {
      if (status === "accepted") {
        return { name: _name, status: "pass" as const, message: `Nova accepts microversion ${args.microversion}.` }
      }
      if (status === "rejected") {
        return {
          name: _name,
          status: "fail" as const,
          message: `Nova rejected microversion ${args.microversion} (HTTP 406) — this cloud's Nova is outside kumulo's supported range.`
        }
      }
      return { name: _name, status: "fail" as const, message: "Could not reach Nova to verify microversion support." }
    })
  )
})
