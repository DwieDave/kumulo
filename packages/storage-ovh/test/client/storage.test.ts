import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeStorageClient } from "../../src/client/storage.ts"

const _fixtureBaseUrl = "https://fixture.invalid"

/**
 * Fixture-replay HttpClient (zero network) — asserts request shape, replays
 * canned OVH v1 responses. `prependUrl` gives the generated client's relative
 * request paths an absolute origin, same as `ovhHttpClientLayer` does at the
 * real composition root (provider-ovh).
 */
const _rawHttpClient = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl(_fixtureBaseUrl))
  )

const _fixtureHttpClient = (fixture: { readonly status: number; readonly body: unknown }) =>
  _rawHttpClient(() => new Response(JSON.stringify(fixture.body), { status: fixture.status }))

it.effect("lists storage containers (GET /region/{regionName}/storage)", () =>
  Effect.gen(function* () {
    const httpClient = _fixtureHttpClient({
      status: 200,
      body: [{ name: "staging-eu-backups", region: "DE1", createdAt: "2026-01-01T00:00:00Z" }]
    })
    const client = makeStorageClient(httpClient)
    const result = yield* client.getStorageContainersOnRegion("kumulo-project", "DE1", undefined)
    assert.strictEqual(result[0]?.name, "staging-eu-backups")
  }))

it.effect("creates a storage container against the target path", () =>
  Effect.gen(function* () {
    let capturedPath: string | undefined
    const httpClient = _rawHttpClient((request) => {
      capturedPath = request.url
      return new Response(JSON.stringify({ name: "staging-eu-backups", region: "DE1" }), { status: 200 })
    })
    const client = makeStorageClient(httpClient)
    const result = yield* client.createStorageContainerOnRegion("kumulo-project", "DE1", {
      payload: { name: "staging-eu-backups" }
    })
    assert.strictEqual(capturedPath, `${_fixtureBaseUrl}/cloud/project/kumulo-project/region/DE1/storage`)
    assert.strictEqual(result.name, "staging-eu-backups")
  }))

it.effect("deletes a storage container (void response)", () =>
  Effect.gen(function* () {
    let capturedPath: string | undefined
    const httpClient = _rawHttpClient((request) => {
      capturedPath = request.url
      return new Response(null, { status: 204 })
    })
    const client = makeStorageClient(httpClient)
    yield* client.deteteStorageContainerOnRegion("kumulo-project", "DE1", "staging-eu-backups", undefined)
    assert.strictEqual(capturedPath, `${_fixtureBaseUrl}/cloud/project/kumulo-project/region/DE1/storage/staging-eu-backups`)
  }))

it.effect("lists objects in a container (emptiness check)", () =>
  Effect.gen(function* () {
    const httpClient = _fixtureHttpClient({ status: 200, body: [] })
    const client = makeStorageClient(httpClient)
    const result = yield* client.getObjectsInformationOnContainerOnRegion("kumulo-project", "DE1", "staging-eu-backups", undefined)
    assert.deepStrictEqual(result, [])
  }))

it.effect("creates a project user, then issues S3 credentials for it", () =>
  Effect.gen(function* () {
    const capturedPaths: Array<string> = []
    const httpClient = _rawHttpClient((request) => {
      capturedPaths.push(request.url)
      if (request.url.endsWith("/s3Credentials")) {
        return new Response(JSON.stringify({ access: "AK", secret: "SK" }), { status: 200 })
      }
      return new Response(JSON.stringify({ id: 42, username: "kumulo-staging" }), { status: 200 })
    })
    const client = makeStorageClient(httpClient)
    const user = yield* client.postCloudProjectServiceNameUser("kumulo-project", { payload: { description: "kumulo-staging" } })
    const credentials = yield* client.postCloudProjectServiceNameUserUserIdS3Credentials("kumulo-project", String(user.id), undefined)
    assert.strictEqual(credentials.access, "AK")
    assert.deepStrictEqual(capturedPaths, [
      `${_fixtureBaseUrl}/cloud/project/kumulo-project/user`,
      `${_fixtureBaseUrl}/cloud/project/kumulo-project/user/42/s3Credentials`
    ])
  }))

it.effect("surfaces a non-2xx status as a decodable error response", () =>
  Effect.gen(function* () {
    const httpClient = _fixtureHttpClient({ status: 404, body: { message: "container not found" } })
    const client = makeStorageClient(httpClient)
    const failure = yield* Effect.flip(client.getStorageContainerOnRegion("kumulo-project", "DE1", "missing", undefined))
    assert.strictEqual(failure._tag, "HttpClientError")
  }))
