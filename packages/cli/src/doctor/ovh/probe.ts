import { Effect } from "effect"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import type { SchemaError } from "effect/Schema"

export type ProbeStatus = "ok" | "unauthenticated" | "forbidden" | "unreachable"

/**
 * The one `Mks` method every OVH doctor check needs — narrowed to a plain
 * (non-generic) signature so fixtures can implement it directly, instead of
 * `Mks`'s `<Config extends OperationConfig>` overload (which forces every
 * caller, fixtures included, to satisfy the conditional `WithOptionalResponse`
 * return type generically). Real wiring adapts `Mks.getCloudProjectServiceNameKube`
 * with `(serviceName) => mks.getCloudProjectServiceNameKube(serviceName, undefined)`.
 */
export interface OvhProjectClient {
  readonly getCloudProjectServiceNameKube: (
    serviceName: string
  ) => Effect.Effect<ReadonlyArray<string>, HttpClientError.HttpClientError | SchemaError>
}

/**
 * Shared `GET /kube` probe, classified by HTTP status — `authValidityCheck`
 * and `projectAccessCheck` each read this from their own angle (401 vs 403
 * are two different failure modes worth two distinct actionable messages).
 */
export const probeStatus = (args: {
  readonly mks: OvhProjectClient
  readonly serviceName: string
}): Effect.Effect<ProbeStatus> =>
  args.mks.getCloudProjectServiceNameKube(args.serviceName).pipe(
    Effect.match({ onFailure: _classify, onSuccess: () => "ok" as const })
  )

const _classify = (error: unknown): ProbeStatus => {
  if (!(error instanceof HttpClientError.HttpClientError) || error.reason._tag !== "StatusCodeError") {
    return "unreachable"
  }
  if (error.reason.response.status === 401) return "unauthenticated"
  if (error.reason.response.status === 403) return "forbidden"
  return "unreachable"
}
