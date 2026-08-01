import { Effect, Schema } from "effect"
import type { HttpClient} from "effect/unstable/http";
import { HttpClientRequest } from "effect/unstable/http"
import type { DoctorCheck } from "../doctor/types.ts"
import type { OpenStackEndpointResolver } from "./nova.ts"

export interface NovaLimits {
  readonly maxTotalInstances: number
  readonly totalInstancesUsed: number
}

// missing/wrong-typed fields silently default to 0/unset, unshaped responses fall through to _unknownLimits
const _NovaLimitsResponse = Schema.Struct({
  limits: Schema.optional(Schema.Struct({
    absolute: Schema.optional(Schema.Struct({
      maxTotalInstances: Schema.optional(Schema.Number),
      totalInstancesUsed: Schema.optional(Schema.Number)
    }))
  }))
})

const _unknownLimits: NovaLimits = { maxTotalInstances: -1, totalInstancesUsed: 0 }

export const fetchNovaLimits = (args: {
  readonly client: HttpClient.HttpClient
  readonly keystone: OpenStackEndpointResolver
  readonly region: string
}): Effect.Effect<NovaLimits> =>
  args.keystone.endpoint({ service: "compute", region: args.region }).pipe(
    Effect.flatMap((base) => args.client.execute(HttpClientRequest.get(new URL("v2.1/limits", base).toString()))),
    Effect.flatMap((response) =>
      response.status >= 200 && response.status < 300
        ? response.json.pipe(Effect.mapError(() => "bad-json" as const))
        : Effect.fail("bad-status" as const)
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(_NovaLimitsResponse)),
    Effect.map((decoded): NovaLimits => ({
      maxTotalInstances: decoded.limits?.absolute?.maxTotalInstances ?? 0,
      totalInstancesUsed: decoded.limits?.absolute?.totalInstancesUsed ?? 0
    })),
    Effect.orElseSucceed(() => _unknownLimits)
  )

const _name = "openstack-quota-headroom"

const _passMessage = (total: number, max: number): string =>
  max < 0
    ? `Quota headroom OK: ${total} Nova instances planned, no quota limit reported.`
    : `Quota headroom OK: ${total}/${max} Nova instances after this plan.`

export const quotaHeadroomCheck = (args: {
  readonly limits: Effect.Effect<NovaLimits>
  readonly plannedInstanceCount: number
}): DoctorCheck => ({
  name: _name,
  run: args.limits.pipe(
    Effect.map((limits) => {
      const total = limits.totalInstancesUsed + args.plannedInstanceCount
      if (limits.maxTotalInstances >= 0 && total > limits.maxTotalInstances) {
        return {
          name: _name,
          status: "fail" as const,
          message: `Plan needs ${total} Nova instances (existing + planned), exceeding the quota of ${limits.maxTotalInstances}.`
        }
      }
      return { name: _name, status: "pass" as const, message: _passMessage(total, limits.maxTotalInstances) }
    })
  )
})
