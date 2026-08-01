import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeStorageClient } from "../../src/client/storage.ts"
import { capturedJson } from "./capture.ts"
import { makeFakeStorageServer } from "./fake-storage-server.ts"

const _fixtureBaseUrl = "https://fixture.invalid"

const _rawHttpClient = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

const _fixtureHttpClient = (status: number, body: unknown) => _rawHttpClient(() => new Response(JSON.stringify(body), { status }))

const _storage = {
  uuid: "s1",
  size: 25,
  tier: "maxiops" as const,
  zone: "de-fra1",
  title: "demo",
  encrypted: true,
  state: "online" as const
}

it.effect("decodes GET /1.3/storage/{uuid} wrapped as {storage: {...}}", () =>
  Effect.gen(function*() {
    const client = makeStorageClient(_fixtureHttpClient(200, { storage: _storage }))
    const storage = yield* client.get("s1")
    assert.deepStrictEqual(storage, _storage)
  }))

it.effect("decodes GET /1.3/storage wrapped as {storages: {storage: [...]}}", () =>
  Effect.gen(function*() {
    const client = makeStorageClient(_fixtureHttpClient(200, { storages: { storage: [_storage] } }))
    const list = yield* client.list()
    assert.deepStrictEqual(list, [_storage])
  }))

it.effect("R4/D3: a bare storage response (no envelope) is a decode failure", () =>
  Effect.gen(function*() {
    const client = makeStorageClient(_fixtureHttpClient(200, _storage))
    const failure = yield* Effect.flip(client.get("s1"))
    assert.strictEqual(failure._tag, "SchemaError")
  }))

it.effect("POST create wraps the request body as {storage: {...}}", () =>
  Effect.gen(function*() {
    let captured: unknown
    const client = makeStorageClient(
      _rawHttpClient((request) => {
        captured = capturedJson(request)
        return new Response(JSON.stringify({ storage: _storage }), { status: 200 })
      })
    )
    yield* client.create({ size: 25, zone: "de-fra1", title: "demo" })
    assert.deepStrictEqual(captured, { storage: { size: 25, zone: "de-fra1", title: "demo" } })
  }))

it.effect("modify only sends title/size/labels, never tier/zone", () =>
  Effect.gen(function*() {
    let captured: unknown
    const client = makeStorageClient(
      _rawHttpClient((request) => {
        captured = capturedJson(request)
        return new Response(JSON.stringify({ storage: _storage }), { status: 200 })
      })
    )
    yield* client.modify("s1", { title: "renamed", size: 50 })
    assert.deepStrictEqual(captured, { storage: { title: "renamed", size: 50 } })
  }))

it.effect("delete passes ?backups=delete", () =>
  Effect.gen(function*() {
    let capturedPath: string | undefined
    const client = makeStorageClient(
      _rawHttpClient((request) => {
        capturedPath = request.url
        return new Response(null, { status: 204 })
      })
    )
    yield* client.delete("s1")
    assert.strictEqual(capturedPath, `${_fixtureBaseUrl}/1.3/storage/s1?backups=delete`)
  }))

it.effect("fake server: create starts maintenance, polls to online after N reads", () =>
  Effect.gen(function*() {
    const { httpClient } = makeFakeStorageServer({ readyAfterPolls: 2 })
    const client = makeStorageClient(httpClient)
    const created = yield* client.create({ size: 25, zone: "de-fra1", title: "demo" })
    assert.strictEqual(created.state, "maintenance")
    const poll1 = yield* client.get(created.uuid)
    assert.strictEqual(poll1.state, "maintenance")
    const poll2 = yield* client.get(created.uuid)
    assert.strictEqual(poll2.state, "maintenance")
    const poll3 = yield* client.get(created.uuid)
    assert.strictEqual(poll3.state, "online")
  }))

it.effect("fake server: modify updates title/size and preserves the envelope", () =>
  Effect.gen(function*() {
    const { httpClient } = makeFakeStorageServer()
    const client = makeStorageClient(httpClient)
    const created = yield* client.create({ size: 25, zone: "de-fra1", title: "demo" })
    const modified = yield* client.modify(created.uuid, { title: "renamed" })
    assert.strictEqual(modified.title, "renamed")
    assert.strictEqual(modified.zone, "de-fra1")
  }))
