import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeUksClient } from "../../src/client/uks.ts"
import { capturedJson } from "./capture.ts"

const _fixtureBaseUrl = "https://fixture.invalid"

const _rawHttpClient = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

const _fixtureHttpClient = (status: number, body: unknown) => _rawHttpClient(() => new Response(JSON.stringify(body), { status }))

const _cluster = {
  uuid: "c1",
  name: "demo",
  zone: "de-fra1",
  network: "net-uuid",
  network_cidr: "10.0.0.0/24",
  version: "1.31",
  plan: "dev-md",
  state: "running" as const
}

it.effect("decodes GET /1.3/kubernetes/{uuid} against the documented cluster shape", () =>
  Effect.gen(function*() {
    const client = makeUksClient(_fixtureHttpClient(200, _cluster))
    const cluster = yield* client.get("c1")
    assert.deepStrictEqual(cluster, _cluster)
  }))

// UKS lists are BARE arrays (Q8, observed) — the enveloped fixture this
// replaced is exactly what let the client ship a schema the API never matches.
it.effect("decodes GET /1.3/kubernetes as a bare array", () =>
  Effect.gen(function*() {
    const client = makeUksClient(_fixtureHttpClient(200, [_cluster]))
    const clusters = yield* client.list()
    assert.strictEqual(clusters.length, 1)
    assert.strictEqual(clusters[0]?.uuid, "c1")
  }))

it.effect("POST create sends the full body and decodes the created cluster", () =>
  Effect.gen(function*() {
    let captured: unknown
    const client = makeUksClient(
      _rawHttpClient((request) => {
        captured = capturedJson(request)
        return new Response(JSON.stringify(_cluster), { status: 200 })
      })
    )
    const body = { name: "demo", zone: "de-fra1", version: "1.31", network: "net-uuid", network_cidr: "10.0.0.0/24" }
    yield* client.create(body)
    // D7: `version` is part of the create body — a cluster created without it
    // silently lands on UpCloud's default.
    assert.deepStrictEqual(captured, body)
  }))

it.effect("GET available-upgrades decodes {\"versions\": [...]}", () =>
  Effect.gen(function*() {
    const client = makeUksClient(_fixtureHttpClient(200, { versions: ["1.31"] }))
    const versions = yield* client.availableUpgrades("c1")
    assert.deepStrictEqual(versions, ["1.31"])
  }))

it.effect("GET kubeconfig decodes {\"kubeconfig\": \"<yaml>\"}", () =>
  Effect.gen(function*() {
    const client = makeUksClient(_fixtureHttpClient(200, { kubeconfig: "apiVersion: v1\n" }))
    const kubeconfig = yield* client.kubeconfig("c1")
    assert.strictEqual(kubeconfig, "apiVersion: v1\n")
  }))

it.effect("R4: a shape mismatch surfaces as a decode failure, not undefined", () =>
  Effect.gen(function*() {
    const client = makeUksClient(_fixtureHttpClient(200, { uuid: "c1" }))
    const failure = yield* Effect.flip(client.get("c1"))
    assert.strictEqual(failure._tag, "SchemaError")
  }))

it.effect("DELETE /1.3/kubernetes/{uuid} hits the right path", () =>
  Effect.gen(function*() {
    let capturedPath: string | undefined
    const client = makeUksClient(
      _rawHttpClient((request) => {
        capturedPath = request.url
        return new Response(null, { status: 204 })
      })
    )
    yield* client.delete("c1")
    assert.strictEqual(capturedPath, `${_fixtureBaseUrl}/1.3/kubernetes/c1`)
  }))
