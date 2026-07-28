import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeZoneClient } from "../../src/client/zone.ts"

const _client = (status: number, body: unknown) =>
  makeZoneClient(
    HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), { status })))).pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
    )
  )

it.effect("GET /1.3/zone decodes UpCloud's nested {zones:{zone:[...]}} envelope", () =>
  Effect.gen(function*() {
    const zones = yield* _client(200, {
      zones: { zone: [{ id: "de-fra1", description: "Frankfurt #1", public: "yes" }, { id: "es-mad1" }] }
    }).list()
    assert.deepStrictEqual(zones.map((zone) => zone.id), ["de-fra1", "es-mad1"])
  }))

it.effect("a response missing the envelope is a decode failure, never an empty list (R4)", () =>
  Effect.gen(function*() {
    const result = yield* Effect.result(_client(200, { zones: [{ id: "de-fra1" }] }).list())
    assert.strictEqual(result._tag, "Failure")
  }))
