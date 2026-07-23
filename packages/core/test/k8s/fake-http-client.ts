import { Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

// kumulo: recorded-response fixture fake — same shape as
// packages/openstack/test/transport/http-client.test.ts's `_fakeBase`,
// duplicated locally (core can't import a sibling package's test helper).
export const fakeHttpClient = (
  handler: (request: HttpClientRequest.HttpClientRequest, call: number) => Response
): { client: HttpClient.HttpClient; requests: () => Array<HttpClientRequest.HttpClientRequest> } => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = []
  const client = HttpClient.make((request) => {
    requests.push(request)
    return Effect.succeed(HttpClientResponse.fromWeb(request, handler(request, requests.length)))
  })
  return { client, requests: () => requests }
}
