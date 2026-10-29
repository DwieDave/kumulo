import { Effect } from "effect"
import type { Schema } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"
import { makeObjectStorageClient } from "../../src/client/object-storage.ts"
import { makeFakeObjectStorageServer } from "./fake-object-storage-server.ts"

const _fixtureBaseUrl = "https://fixture.invalid"

const _rawHttpClient = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

const _fixtureHttpClient = (status: number, body: Schema.Json) => _rawHttpClient(() => new Response(JSON.stringify(body), { status }))

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

it.effect("services.list pages with limit=100 until a short page", () =>
  Effect.gen(function*() {
    const fake = makeFakeObjectStorageServer()
    const client = makeObjectStorageClient(fake.httpClient)

    for (let i = 0; i < 150; i++) {
      yield* client.services.create({ name: `svc-${i}`, region: "europe-1", configured_status: "started" })
    }

    fake.requests.length = 0
    const list = yield* client.services.list()
    assert.strictEqual(list.length, 150)
    assert.deepStrictEqual(fake.requests, [
      "GET /1.3/object-storage-2?limit=100&offset=0",
      "GET /1.3/object-storage-2?limit=100&offset=100"
    ])
  }))

it.effect("buckets.list pages with limit=100 until a short page", () =>
  Effect.gen(function*() {
    const fake = makeFakeObjectStorageServer()
    const client = makeObjectStorageClient(fake.httpClient)
    const service = yield* client.services.create({ name: "demo-objsto", region: "europe-1", configured_status: "started" })

    for (let i = 0; i < 101; i++) yield* client.buckets.create(service.uuid, `bucket-${i}`)
    fake.requests.length = 0
    const list = yield* client.buckets.list(service.uuid)
    assert.strictEqual(list.length, 101)
    assert.deepStrictEqual(fake.requests, [
      `GET /1.3/object-storage-2/${service.uuid}/buckets?limit=100&offset=0`,
      `GET /1.3/object-storage-2/${service.uuid}/buckets?limit=100&offset=100`
    ])
  }))

it.effect("a bucket response without deleted decodes", () =>
  Effect.gen(function*() {
    const client = makeObjectStorageClient(_fixtureHttpClient(200, [{ name: "b", total_objects: 0, total_size_bytes: 0 }]))
    const list = yield* client.buckets.list("svc1")
    assert.deepStrictEqual(list, [{ name: "b", total_objects: 0, total_size_bytes: 0 }])
  }))

it.effect("a regions response with zone objects decodes", () =>
  Effect.gen(function*() {
    const body = [{ name: "europe-1", primary_zone: "fi-hel1", zones: [{ name: "fi-hel1" }] }]
    const client = makeObjectStorageClient(_fixtureHttpClient(200, body))
    assert.deepStrictEqual(yield* client.regions(), body)
  }))

it.effect("an endpoint with a mode decodes", () =>
  Effect.gen(function*() {
    const endpoint = { domain_name: "x.example", type: "public", mode: "api" }
    const client = makeObjectStorageClient(_fixtureHttpClient(200, { ..._service, endpoints: [endpoint] }))
    assert.deepStrictEqual((yield* client.services.get("svc1")).endpoints, [endpoint])
  }))

it.effect("users.policies.attach posts the policy name and list returns it", () =>
  Effect.gen(function*() {
    const fake = makeFakeObjectStorageServer()
    const client = makeObjectStorageClient(fake.httpClient)
    const service = yield* client.services.create({ name: "demo-objsto", region: "europe-1", configured_status: "started" })
    yield* client.users.create(service.uuid, "u")
    assert.deepStrictEqual(yield* client.users.policies.list(service.uuid, "u"), [])
    yield* client.users.policies.attach(service.uuid, "u", "ECSS3FullAccess")
    assert.deepStrictEqual(fake.policies.get(`${service.uuid}/u`), ["ECSS3FullAccess"])
    const listed = yield* client.users.policies.list(service.uuid, "u")
    assert.deepStrictEqual(listed.map((p) => p.name), ["ECSS3FullAccess"])
    assert.ok(fake.requests.includes(`POST /1.3/object-storage-2/${service.uuid}/users/u/policies`))
  }))
