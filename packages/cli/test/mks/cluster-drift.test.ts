import { Effect, Layer } from "effect"
import { layerNoop } from "effect/FileSystem"
import * as HttpClient from "effect/unstable/http/HttpClient"
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import { assert, it } from "@effect/vitest"
import { dnsNoopLive } from "@kumulo/core"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { loadConfig } from "../../src/config.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { buildMksPlan, type MksInventory, type MksPlanInput } from "../../src/mks/plan.ts"
import { applyMksEffect } from "../../src/mks/reconcile.ts"

// ── plan ────────────────────────────────────────────────────────────────────

const _config: MksPlanInput = {
  name: "prod-eu",
  worker_pools: [],
  volumes: { module: "none" },
  version: "1.31.4",
  auth: { region: "GRA5" }
}

const _live = (state: MksInventory["clusterState"]): MksInventory => ({
  clusterExists: true,
  poolNames: new Set(),
  volumeNames: new Set(),
  clusterState: state
})

it("a kubernetes minor bump plans as an in-place Update on the cluster row", () => {
  const plan = buildMksPlan({ config: _config, inventory: _live({ region: "GRA5", version: "1.30.9" }) })
  assert.deepStrictEqual(plan.actions, [
    { _tag: "Update", name: "mks-cluster/prod-eu", reason: "kubernetes version 1.30 → 1.31" }
  ])
})

/** The cluster row's tag plus its reason (empty when the tag carries none) — keeps assertions narrowing-free. */
const _clusterRow = (inventory: MksInventory): readonly [string, string] => {
  const [action] = buildMksPlan({ config: _config, inventory }).actions
  if (action === undefined) return ["missing", ""]
  return [action._tag, action._tag === "Update" || action._tag === "ReplaceNeedsConfirm" ? action.reason : ""]
}

it("a region change plans as ReplaceNeedsConfirm naming the field, never a silent NoOp", () => {
  const [tag, reason] = _clusterRow(_live({ region: "DE1", version: "1.31.4" }))
  assert.strictEqual(tag, "ReplaceNeedsConfirm")
  assert.include(reason, "auth.region")
})

it("an unchanged cluster stays NoOp — patch level and region casing are not drift", () => {
  const plan = buildMksPlan({ config: _config, inventory: _live({ region: "gra5", version: "1.31.9" }) })
  assert.deepStrictEqual(plan.actions, [{ _tag: "NoOp", name: "mks-cluster/prod-eu" }])
})

it("a cluster whose state was never read back is never treated as drifted", () => {
  const plan = buildMksPlan({ config: _config, inventory: _live(undefined) })
  assert.deepStrictEqual(plan.actions, [{ _tag: "NoOp", name: "mks-cluster/prod-eu" }])
})

it("a downgrade is refused rather than planned as an upgrade", () => {
  const [tag, reason] = _clusterRow(_live({ region: "GRA5", version: "1.33.0" }))
  assert.strictEqual(tag, "ReplaceNeedsConfirm")
  assert.include(reason, "version")
})

// ── apply ───────────────────────────────────────────────────────────────────

const _yaml = `
name: prod-eu
provider: ovh
distro: ovh-mks
version: "1.31.0"
auth:
  method: application_credential
  region: GRA5
worker_pools: []
dns:
  module: none
  zone: unused.example.com
  ttl: 300
  records: []
volumes:
  module: none
  managed: []
object_storage:
  module: none
  buckets: []
secrets:
  sink: none
  dir: .
`

/** One live cluster, plus a log of every mutating request — a refusal must leave it empty. */
const _fakeMks = (cluster: { readonly region: string; readonly version: string }) => {
  const mutations: Array<string> = []
  const body = { id: "kube-1", name: "prod-eu", status: "READY", url: "https://kube-1.mks.ovh", ...cluster }
  const _handle = (request: HttpClientRequest.HttpClientRequest): Response => {
    const path = new URL(request.url).pathname
    if (request.method !== "GET") mutations.push(`${request.method} ${path}`)
    if (path.endsWith("/kube") && request.method === "GET") return _json(["kube-1"])
    if (path.endsWith("/kube/kube-1") && request.method === "GET") return _json(body)
    if (path.endsWith("/nodepool") && request.method === "GET") return _json([])
    if (path.endsWith("/update") && request.method === "POST") return new Response(null, { status: 200 })
    return new Response(JSON.stringify({ message: `unhandled ${request.method} ${path}` }), { status: 500 })
  }
  const httpClient = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, _handle(request)))).pipe(
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://fixture.invalid"))
  )
  return { mutations, layer: Layer.succeed(MksEnv, { mks: makeMksClient(httpClient), serviceName: "service-1" }) }
}

const _json = (value: unknown): Response =>
  new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })

const _fsTestLayer = layerNoop({ readFileString: () => Effect.succeed(_yaml) })

it.effect("applying a kubernetes minor bump asks OVH to upgrade the cluster", () =>
  Effect.gen(function*() {
    const config = yield* loadConfig("cluster.yaml")
    const server = _fakeMks({ region: "GRA5", version: "1.30.9" })

    yield* applyMksEffect({ config }).pipe(Effect.provide(server.layer), Effect.provide(dnsNoopLive))

    assert.deepStrictEqual(server.mutations, ["POST /cloud/project/service-1/kube/kube-1/update"])
  }).pipe(Effect.provide(_fsTestLayer)))

it.effect("applying a region change fails naming the field and performs zero mutations", () =>
  Effect.gen(function*() {
    const config = yield* loadConfig("cluster.yaml")
    const server = _fakeMks({ region: "DE1", version: "1.31.0" })

    const failure = yield* applyMksEffect({ config }).pipe(
      Effect.provide(server.layer),
      Effect.provide(dnsNoopLive),
      Effect.flip
    )

    assert.strictEqual(failure._tag, "ResourceConflict")
    assert.include(JSON.stringify(failure), "auth.region")
    assert.deepStrictEqual(server.mutations, [])
  }).pipe(Effect.provide(_fsTestLayer)))

it.effect("applying an unchanged cluster mutates nothing", () =>
  Effect.gen(function*() {
    const config = yield* loadConfig("cluster.yaml")
    const server = _fakeMks({ region: "GRA5", version: "1.31.7" })

    yield* applyMksEffect({ config }).pipe(Effect.provide(server.layer), Effect.provide(dnsNoopLive))

    assert.deepStrictEqual(server.mutations, [])
  }).pipe(Effect.provide(_fsTestLayer)))
