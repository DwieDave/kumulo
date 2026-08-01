import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeObjectStorageClient } from "../../src/client/object-storage.ts"
import { makeFakeObjectStorageServer } from "./fake-object-storage-server.ts"

const _fixtureBaseUrl = "https://fixture.invalid"

const _rawHttpClient = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

const _fixtureHttpClient = (status: number, body: unknown) => _rawHttpClient(() => new Response(JSON.stringify(body), { status }))

const _service = {
  uuid: "svc1",
  name: "demo-objsto",
  region: "europe-1",
  configured_status: "started" as const,
  operational_state: "running"
}

it.effect("decodes GET /object-storage-2/{uuid} bare (no envelope)", () =>
  Effect.gen(function*() {
    const client = makeObjectStorageClient(_fixtureHttpClient(200, _service))
    const service = yield* client.services.get("svc1")
    assert.deepStrictEqual(service, _service)
  }))

it.effect("R4/D3: a wrapped object-storage response ({service: {...}}) is a decode failure", () =>
  Effect.gen(function*() {
    const client = makeObjectStorageClient(_fixtureHttpClient(200, { service: _service }))
    const failure = yield* Effect.flip(client.services.get("svc1"))
    assert.strictEqual(failure._tag, "SchemaError")
  }))

it.effect("decodes GET /object-storage-2 as a bare array", () =>
  Effect.gen(function*() {
    const client = makeObjectStorageClient(_fixtureHttpClient(200, [_service]))
    const list = yield* client.services.list()
    assert.deepStrictEqual(list, [_service])
  }))

it.effect("decodes GET /object-storage-2/regions", () =>
  Effect.gen(function*() {
    const client = makeObjectStorageClient(_fixtureHttpClient(200, [{ name: "europe-1", primary_zone: "de-fra1" }]))
    const regions = yield* client.regions()
    assert.deepStrictEqual(regions, [{ name: "europe-1", primary_zone: "de-fra1" }])
  }))

it.effect("fake server: service walks setup-* to running", () =>
  Effect.gen(function*() {
    const { httpClient } = makeFakeObjectStorageServer()
    const client = makeObjectStorageClient(httpClient)
    const created = yield* client.services.create({ name: "demo-objsto", region: "europe-1", configured_status: "started" })
    assert.strictEqual(created.operational_state, "setup-network")
    const states: Array<string> = []
    for (let i = 0; i < 5; i++) {
      const polled = yield* client.services.get(created.uuid)
      states.push(polled.operational_state)
    }
    assert.deepStrictEqual(states, ["setup-service", "setup-dns", "setup-checkup", "running", "running"])
  }))

it.effect("fake server: access key secret is present only in the create response", () =>
  Effect.gen(function*() {
    const { httpClient } = makeFakeObjectStorageServer()
    const client = makeObjectStorageClient(httpClient)
    const service = yield* client.services.create({ name: "demo-objsto", region: "europe-1", configured_status: "started" })
    yield* client.users.create(service.uuid, "demo-kumulo")
    const created = yield* client.accessKeys.create(service.uuid, "demo-kumulo")
    assert.ok(created.secret_access_key !== undefined)
    const listed = yield* client.accessKeys.list(service.uuid, "demo-kumulo")
    assert.strictEqual(listed[0]?.access_key_id, created.access_key_id)
    assert.strictEqual(listed[0]?.secret_access_key, undefined)
  }))

it.effect("fake server: bucket delete is async, deleted:true for one poll then gone", () =>
  Effect.gen(function*() {
    const { httpClient } = makeFakeObjectStorageServer()
    const client = makeObjectStorageClient(httpClient)
    const service = yield* client.services.create({ name: "demo-objsto", region: "europe-1", configured_status: "started" })
    yield* client.buckets.create(service.uuid, "demo-bucket")
    yield* client.buckets.delete(service.uuid, "demo-bucket")
    const firstPoll = yield* client.buckets.list(service.uuid)
    assert.strictEqual(firstPoll.length, 1)
    assert.strictEqual(firstPoll[0]?.deleted, true)
    const secondPoll = yield* client.buckets.list(service.uuid)
    assert.strictEqual(secondPoll.length, 0)
  }))

it.effect("fake server: service delete 409s with a non-empty bucket unless force=true", () =>
  Effect.gen(function*() {
    const { httpClient } = makeFakeObjectStorageServer()
    const client = makeObjectStorageClient(httpClient)
    const service = yield* client.services.create({ name: "demo-objsto", region: "europe-1", configured_status: "started" })
    yield* client.buckets.create(service.uuid, "demo-bucket")
    const failure = yield* Effect.flip(client.services.delete(service.uuid))
    assert.strictEqual(failure._tag, "HttpClientError")
    yield* client.services.delete(service.uuid, true)
  }))
