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

const _network = {
  uuid: "net-1",
  name: "kumulo-demo",
  zone: "de-fra1",
  router: "router-1",
  ip_networks: [{ address: "10.0.0.0/24", dhcp: true, family: "IPv4" as const }]
}
const _router = { uuid: "router-1", name: "kumulo-demo", type: "normal" }

it.effect("POST /1.3/network sends {network: body} and decodes {network: {...}}", () =>
  Effect.gen(function*() {
    let captured: unknown
    const client = makeNetworkClient(
      _rawHttpClient((request) => {
        captured = capturedJson(request)
        return new Response(JSON.stringify({ network: _network }), { status: 200 })
      })
    )
    const created = yield* client.create({
      name: "kumulo-demo",
      zone: "de-fra1",
      ip_networks: [{ address: "10.0.0.0/24", dhcp: true, family: "IPv4" }]
    })
    assert.deepStrictEqual(captured, {
      network: { name: "kumulo-demo", zone: "de-fra1", ip_networks: [{ address: "10.0.0.0/24", dhcp: true, family: "IPv4" }] }
    })
    assert.deepStrictEqual(created, _network)
  }))

it.effect("GET /1.3/network decodes {networks: [...]}", () =>
  Effect.gen(function*() {
    const client = makeNetworkClient(_fixtureHttpClient(200, { networks: [_network] }))
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
