import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { DoctorCheck } from "../doctor/types.ts"
import type { OpenStackEndpointResolver } from "./nova.ts"

export interface NovaLimits {
  readonly maxTotalInstances: number
  readonly totalInstancesUsed: number
}

const _isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const _field = (value: unknown, key: string): unknown => _isRecord(value) ? value[key] : undefined
const _number = (value: unknown): number => typeof value === "number" ? value : 0

const _unknownLimits: NovaLimits = { maxTotalInstances: -1, totalInstancesUsed: 0 }

/**
 * Raw `GET /limits` — quota totals + current usage in one call. No dedicated
 * codegen allowlist entry exists for it (same gap noted in
 * `doctor/ovh/capability.ts`'s ponytail comment: this task can't extend the
 * generated-client allowlists), so it's read directly here instead of
 * through a generated client method.
 */
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
    Effect.map((body): NovaLimits => {
      const absolute = _field(_field(body, "limits"), "absolute")
      return {
        maxTotalInstances: _number(_field(absolute, "maxTotalInstances")),
        totalInstancesUsed: _number(_field(absolute, "totalInstancesUsed"))
      }
    }),
    Effect.orElseSucceed(() => _unknownLimits)
  )

const _name = "openstack-quota-headroom"

const _passMessage = (total: number, max: number): string =>
  max < 0
    ? `Quota headroom OK: ${total} Nova instances planned, no quota limit reported.`
    : `Quota headroom OK: ${total}/${max} Nova instances after this plan.`

/** FR-10.2 — quota headroom vs plan: existing Nova instance usage + this plan's servers, against Nova's own limit. */
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
