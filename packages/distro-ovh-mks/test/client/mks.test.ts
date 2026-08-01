import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeMksClient } from "../../src/client/mks.ts"

const _fixtureBaseUrl = "https://fixture.invalid"

const _rawHttpClient = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

const _fixtureHttpClient = (fixture: { readonly status: number; readonly body: unknown }) =>
  _rawHttpClient(() => new Response(JSON.stringify(fixture.body), { status: fixture.status }))

it.effect("lists clusters (GET /cloud/project/{serviceName}/kube)", () =>
  Effect.gen(function* () {
    const httpClient = _fixtureHttpClient({ status: 200, body: ["kube-id-1", "kube-id-2"] })
    const client = makeMksClient(httpClient)
    const result = yield* client.getCloudProjectServiceNameKube("service-1", undefined)
    assert.deepStrictEqual(result, ["kube-id-1", "kube-id-2"])
  }))

it.effect("creates a cluster and decodes the cluster resource (POST /kube)", () =>
  Effect.gen(function* () {
    const cluster = {
      id: "11111111-1111-1111-1111-111111111111",
      name: "prod-eu",
      region: "GRA5",
      version: "1.29",
      status: "INSTALLING",
      updatePolicy: "ALWAYS_UPDATE"
    }
    let capturedPath: string | undefined
    const httpClient = _rawHttpClient((request) => {
      capturedPath = request.url
      return new Response(JSON.stringify(cluster), { status: 200 })
    })
    const client = makeMksClient(httpClient)
    const result = yield* client.postCloudProjectServiceNameKube("service-1", {
      payload: { name: "prod-eu", region: "GRA5" }
    })
    assert.strictEqual(capturedPath, `${_fixtureBaseUrl}/cloud/project/service-1/kube`)
    assert.strictEqual(result.name, "prod-eu")
    assert.strictEqual(result.status, "INSTALLING")
  }))

it.effect("fetches a kubeconfig (POST /kube/{kubeId}/kubeconfig)", () =>
  Effect.gen(function* () {
    const httpClient = _fixtureHttpClient({ status: 200, body: { content: "apiVersion: v1\nkind: Config\n" } })
    const client = makeMksClient(httpClient)
    const result = yield* client.postCloudProjectServiceNameKubeKubeIdKubeconfig("service-1", "kube-1", undefined)
    assert.match(result.content ?? "", /kind: Config/)
  }))

it.effect("lists nodepools (GET /kube/{kubeId}/nodepool)", () =>
  Effect.gen(function* () {
    const pool = {
      id: "pool-1",
      name: "workers",
      flavor: "b2-7",
      desiredNodes: 3,
      minNodes: 1,
      maxNodes: 5,
      autoscale: true,
      status: "READY",
      antiAffinity: true,
      monthlyBilled: false
    }
    const httpClient = _fixtureHttpClient({ status: 200, body: [pool] })
    const client = makeMksClient(httpClient)
    const result = yield* client.getCloudProjectServiceNameKubeKubeIdNodepool("service-1", "kube-1", undefined)
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0]?.name, "workers")
    assert.strictEqual(result[0]?.autoscale, true)
  }))

it.effect("surfaces a non-2xx status as a decodable error response", () =>
  Effect.gen(function* () {
    const httpClient = _fixtureHttpClient({ status: 404, body: { message: "cluster not found" } })
    const client = makeMksClient(httpClient)
    const failure = yield* Effect.flip(client.getCloudProjectServiceNameKubeKubeId("service-1", "missing", undefined))
    assert.strictEqual(failure._tag, "HttpClientError")
  }))
