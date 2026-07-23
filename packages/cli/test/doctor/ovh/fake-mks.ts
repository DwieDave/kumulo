import { Effect } from "effect"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import type { OvhProjectClient } from "../../../src/doctor/ovh/probe.ts"

/** A `GET /kube` fake that always succeeds with the given cluster id list. */
export const fakeMksListing = (clusterIds: ReadonlyArray<string>): OvhProjectClient => ({
  getCloudProjectServiceNameKube: () => Effect.succeed(clusterIds)
})

/** A `GET /kube` fake that always fails with the given HTTP status code. */
export const fakeMksStatus = (status: number): OvhProjectClient => {
  const request = HttpClientRequest.get("/cloud/project/service-1/kube")
  const response = HttpClientResponse.fromWeb(request, new Response("", { status }))
  return {
    getCloudProjectServiceNameKube: () =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.StatusCodeError({ request, response, description: "fixture" })
        })
      )
  }
}
