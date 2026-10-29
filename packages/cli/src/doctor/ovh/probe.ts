import { Effect, Predicate } from "effect"
import * as HttpClientError from "effect/http/HttpClientError"
import type { SchemaError } from "effect/Schema"

export type ProbeStatus = "ok" | "unauthenticated" | "forbidden" | "unreachable"

export interface OvhProjectClient {
  readonly getCloudProjectServiceNameKube: (
    serviceName: string
  ) => Effect.Effect<ReadonlyArray<string>, HttpClientError.HttpClientError | SchemaError>
}

export const probeStatus = (args: {
  readonly mks: OvhProjectClient
  readonly serviceName: string
}): Effect.Effect<ProbeStatus> =>
  args.mks.getCloudProjectServiceNameKube(args.serviceName).pipe(
    Effect.match({ onFailure: _classify, onSuccess: () => "ok" as const })
  )

const _classify = (cause: unknown): ProbeStatus => {
  if (!(cause instanceof HttpClientError.HttpClientError) || !Predicate.isTagged(cause.reason, "StatusCodeError")) {
    return "unreachable"
  }

  if (cause.reason.response.status === 401) return "unauthenticated"

  if (cause.reason.response.status === 403) return "forbidden"

  return "unreachable"
}
