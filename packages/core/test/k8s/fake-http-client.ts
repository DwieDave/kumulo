import { Effect } from "effect"
import type { HttpClientRequest} from "effect/http";
import { HttpClient, HttpClientResponse } from "effect/http"

// kumulo: recorded-response fixture fake — same shape as
// packages/openstack/client/test/transport/http-client.test.ts's `_fakeBase`,
// duplicated locally (core can't import a sibling package's test helper).
export interface FakeHttpClient {
  readonly client: HttpClient.HttpClient
  readonly requests: () => Array<HttpClientRequest.HttpClientRequest>
}

export const fakeHttpClient = (
  handler: (request: HttpClientRequest.HttpClientRequest, call: number) => Response
): FakeHttpClient => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = []

  const client = HttpClient.make((request) => {
    requests.push(request)

    return Effect.succeed(HttpClientResponse.fromWeb(request, handler(request, requests.length)))
  })

  return { client, requests: () => requests }
}
