import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeNodeGroupsClient } from "../../src/client/node-groups.ts"
import { capturedJson } from "./capture.ts"

const _fixtureBaseUrl = "https://fixture.invalid"

const _rawHttpClient = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

const _fixtureHttpClient = (status: number, body: unknown) => _rawHttpClient(() => new Response(JSON.stringify(body), { status }))

const _group = { name: "workers-ab12cd34", count: 3, plan: "2xCPU-4GB", state: "running" as const }

it.effect("decodes GET .../node-groups as {node_groups: [...]}", () =>
  Effect.gen(function*() {
    const client = makeNodeGroupsClient(_fixtureHttpClient(200, { node_groups: [_group] }))
    const groups = yield* client.list("c1")
    assert.deepStrictEqual(groups, [_group])
  }))

it.effect("decodes GET .../node-groups/{name} bare", () =>
  Effect.gen(function*() {
    const client = makeNodeGroupsClient(_fixtureHttpClient(200, _group))
    const group = yield* client.get("c1", "workers-ab12cd34")
    assert.deepStrictEqual(group, _group)
  }))

it.effect("PATCH only sends count (D8)", () =>
  Effect.gen(function*() {
    let captured: unknown
    const client = makeNodeGroupsClient(
      _rawHttpClient((request) => {
        captured = capturedJson(request)
        return new Response(JSON.stringify({ ..._group, count: 5 }), { status: 200 })
      })
    )
    const group = yield* client.patch("c1", "workers-ab12cd34", { count: 5 })
    assert.deepStrictEqual(captured, { count: 5 })
    assert.strictEqual(group.count, 5)
  }))

it.effect("DELETE single node hits .../node-groups/{name}/{node}", () =>
  Effect.gen(function*() {
    let capturedPath: string | undefined
    const client = makeNodeGroupsClient(
      _rawHttpClient((request) => {
        capturedPath = request.url
        return new Response(null, { status: 204 })
      })
    )
    yield* client.deleteNode("c1", "workers-ab12cd34", "node-1")
    assert.strictEqual(capturedPath, `${_fixtureBaseUrl}/1.3/kubernetes/c1/node-groups/workers-ab12cd34/node-1`)
  }))

it.effect("R4: an unrecognized state literal surfaces as a decode failure", () =>
  Effect.gen(function*() {
    const client = makeNodeGroupsClient(_fixtureHttpClient(200, { ..._group, state: "not-a-real-state" }))
    const failure = yield* Effect.flip(client.get("c1", "workers-ab12cd34"))
    assert.strictEqual(failure._tag, "SchemaError")
  }))
