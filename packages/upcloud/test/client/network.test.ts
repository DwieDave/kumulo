import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeNetworkClient, makeRouterClient } from "../../src/client/network.ts"
import { capturedJson } from "./capture.ts"

const _fixtureBaseUrl = "https://fixture.invalid"

const _rawHttpClient = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

const _fixtureHttpClient = (status: number, body: unknown) => _rawHttpClient(() => new Response(JSON.stringify(body), { status }))

// Copied from developers.upcloud.com's own response samples, shape-for-shape:
// lists wrap twice, `ip_networks` wraps its array, and `dhcp` is "yes"/"no".
// The earlier fixtures were invented to match the client, so the client's wrong
// guess and the test's wrong guess agreed and CI stayed green.
const _network = {
  uuid: "net-1",
  name: "kumulo-demo",
  zone: "de-fra1",
  type: "private",
  router: "router-1",
  ip_networks: {
    ip_network: [{ address: "10.0.0.0/24", dhcp: "yes" as const, dhcp_default_route: "no" as const, family: "IPv4" as const }]
  }
}
const _router = { uuid: "router-1", name: "kumulo-demo", type: "normal", attached_networks: { network: [] } }

it.effect("POST /1.3/network sends {network: body} and decodes {network: {...}}", () =>
  Effect.gen(function*() {
    let captured: unknown
    const client = makeNetworkClient(
      _rawHttpClient((request) => {
        captured = capturedJson(request)
        return new Response(JSON.stringify({ network: _network }), { status: 200 })
      })
    )
    const ipNetworks = { ip_network: [{ address: "10.0.0.0/24", dhcp: "yes" as const, family: "IPv4" as const }] }
    const created = yield* client.create({ name: "kumulo-demo", zone: "de-fra1", ip_networks: ipNetworks })
    assert.deepStrictEqual(captured, { network: { name: "kumulo-demo", zone: "de-fra1", ip_networks: ipNetworks } })
    assert.deepStrictEqual(created, _network)
  }))

it.effect("GET /1.3/network decodes the double-wrapped {networks: {network: [...]}}", () =>
  Effect.gen(function*() {
    const client = makeNetworkClient(_fixtureHttpClient(200, { networks: { network: [_network] } }))
    const networks = yield* client.list()
    assert.deepStrictEqual(networks, [_network])
  }))

it.effect("DELETE /1.3/network/{uuid} hits the right path", () =>
  Effect.gen(function*() {
    let capturedPath: string | undefined
    const client = makeNetworkClient(
      _rawHttpClient((request) => {
        capturedPath = request.url
        return new Response(null, { status: 204 })
      })
    )
    yield* client.delete("net-1")
    assert.strictEqual(capturedPath, `${_fixtureBaseUrl}/1.3/network/net-1`)
  }))

it.effect("POST /1.3/router decodes {router: {...}}", () =>
  Effect.gen(function*() {
    const client = makeRouterClient(_fixtureHttpClient(200, { router: _router }))
    const router = yield* client.create({ name: "kumulo-demo" })
    assert.deepStrictEqual(router, _router)
  }))

it.effect("R4: a missing ip_networks field surfaces as a decode failure", () =>
  Effect.gen(function*() {
    const client = makeNetworkClient(_fixtureHttpClient(200, { network: { uuid: "net-1", name: "x", zone: "de-fra1" } }))
    const failure = yield* Effect.flip(client.get("net-1"))
    assert.strictEqual(failure._tag, "SchemaError")
  }))

it.effect("GET /1.3/router decodes the double-wrapped {routers: {router: [...]}}", () =>
  Effect.gen(function*() {
    const client = makeRouterClient(_fixtureHttpClient(200, { routers: { router: [_router] } }))
    assert.deepStrictEqual(yield* client.list(), [_router])
  }))

// The exact failure seen against the live API: a singly-wrapped list decoded
// clean under the old schema and produced garbage under the real one.
it.effect("a singly-wrapped list is a decode failure, not an empty list", () =>
  Effect.gen(function*() {
    const result = yield* Effect.result(makeNetworkClient(_fixtureHttpClient(200, { networks: [_network] })).list())
    assert.strictEqual(result._tag, "Failure")
  }))
