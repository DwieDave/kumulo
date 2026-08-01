import type { OpenStackError } from "@kumulo/openstack"
import { Effect } from "effect"
import type { HttpClient} from "effect/unstable/http";
import { HttpClientRequest } from "effect/unstable/http"
import type { DoctorCheck } from "../doctor/types.ts"

export const NOVA_MICROVERSION = "2.96"

export type MicroversionStatus = "accepted" | "rejected" | "unreachable"

export interface OpenStackEndpointResolver {
  readonly endpoint: (
    options: { readonly service: string; readonly region: string }
  ) => Effect.Effect<string, OpenStackError>
}

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
