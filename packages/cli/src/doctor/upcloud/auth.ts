import { Effect, Predicate } from "effect"
import * as HttpClientError from "effect/http/HttpClientError"
import type { UksClient } from "@kumulo/upcloud"
import type { DoctorCheck } from "../types.ts"

const _name = "upcloud-auth-validity"

const _isUnauthenticated = (cause: unknown): boolean =>
  HttpClientError.isHttpClientError(cause) && Predicate.isTagged(cause.reason, "StatusCodeError") &&
  (cause.reason.response.status === 401 || cause.reason.response.status === 403)

/** UpCloud auth validity: a 401/403 on any authenticated call means a bad/expired/under-scoped token. */
export const authValidityCheck = (args: { readonly uks: UksClient }): DoctorCheck => ({
  name: _name,
  run: args.uks.list().pipe(
    Effect.match({
      onSuccess: () => ({ name: _name, status: "pass" as const, message: "UpCloud API token accepted." }),
      onFailure: (error) => ({
        name: _name,
        status: "fail" as const,
        message: _isUnauthenticated(error)
          ? "UpCloud API token is invalid, expired, or lacks permission — check UPCLOUD_API_TOKEN."
          : "Could not reach UpCloud's API to verify the token."
      })
    })
  )
})
