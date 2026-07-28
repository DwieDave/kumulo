import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { makeUksClient, makeZoneClient } from "@kumulo/upcloud"
import { authValidityCheck, controlPlanePlanCheck, nodeGroupPlansCheck, versionSupportedCheck, zoneExistsCheck } from "../../src/doctor/upcloud/index.ts"

const _http = (handle: (request: HttpClientRequest.HttpClientRequest) => Response) =>
  HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
  )

const _json = (status: number, body: unknown) => _http(() => new Response(JSON.stringify(body), { status }))

const _zones = { zones: { zone: [{ id: "de-fra1", public: "yes" }, { id: "fi-priv1", public: "no" }] } }

it.effect("zone check passes for a zone UpCloud actually lists", () =>
  Effect.gen(function*() {
    const result = yield* zoneExistsCheck({ zone: "de-fra1", zones: makeZoneClient(_json(200, _zones)) }).run
    assert.strictEqual(result.status, "pass")
  }))

it.effect("zone check fails for a zone UpCloud does not list", () =>
  Effect.gen(function*() {
    const result = yield* zoneExistsCheck({ zone: "mars-1", zones: makeZoneClient(_json(200, _zones)) }).run
    assert.strictEqual(result.status, "fail")
  }))

// A private-cloud zone is real but unusable by a normal account, so accepting
// it would just move the failure to apply time.
it.effect("zone check rejects a private-cloud zone", () =>
  Effect.gen(function*() {
    const result = yield* zoneExistsCheck({ zone: "fi-priv1", zones: makeZoneClient(_json(200, _zones)) }).run
    assert.strictEqual(result.status, "fail")
  }))

it.effect("zone check does not claim the zone is invalid when the listing itself fails", () =>
  Effect.gen(function*() {
    const result = yield* zoneExistsCheck({ zone: "de-fra1", zones: makeZoneClient(_json(500, {})) }).run
    assert.strictEqual(result.status, "fail")
    assert.include(result.message, "may be fine")
  }))

it.effect("auth check reports a 401 as a token problem, not a reachability one", () =>
  Effect.gen(function*() {
    const result = yield* authValidityCheck({ uks: makeUksClient(_json(401, { error: "nope" })) }).run
    assert.strictEqual(result.status, "fail")
    assert.include(result.message, "UPCLOUD_API_TOKEN")
  }))

it.effect("auth check passes when the API answers", () =>
  Effect.gen(function*() {
    const result = yield* authValidityCheck({ uks: makeUksClient(_json(200, [])) }).run
    assert.strictEqual(result.status, "pass")
  }))

it.effect("control plane plan check fails on a plan UpCloud does not offer", () =>
  Effect.gen(function*() {
    const uks = makeUksClient(_json(200, [{ name: "dev-md" }, { name: "prod-md" }]))
    const result = yield* controlPlanePlanCheck({ uks, plan: "enormous-md" }).run
    assert.strictEqual(result.status, "fail")
    assert.include(result.message, "dev-md")
  }))

it.effect("control plane plan check passes when the plan is offered, and when none is set", () =>
  Effect.gen(function*() {
    const uks = makeUksClient(_json(200, [{ name: "dev-md" }]))
    assert.strictEqual((yield* controlPlanePlanCheck({ uks, plan: "dev-md" }).run).status, "pass")
    assert.strictEqual((yield* controlPlanePlanCheck({ uks, plan: undefined }).run).status, "pass")
  }))

it.effect("node group plan check fails when a pool declares no plan", () =>
  Effect.gen(function*() {
    assert.strictEqual((yield* nodeGroupPlansCheck({ pools: [{ plan: "" }] }).run).status, "fail")
    assert.strictEqual((yield* nodeGroupPlansCheck({ pools: [{ plan: "2xCPU-4GB" }] }).run).status, "pass")
  }))

it.effect("version check accepts a supported minor and rejects an unsupported one", () =>
  Effect.gen(function*() {
    assert.strictEqual((yield* versionSupportedCheck({ version: "1.31" }).run).status, "pass")
    assert.strictEqual((yield* versionSupportedCheck({ version: "1.11" }).run).status, "fail")
  }))
