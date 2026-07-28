import { Effect, Layer } from "effect"
import { assert, it } from "@effect/vitest"
import { deleteMksEffect, reconcileMksDns } from "../../src/mks/reconcile.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { baseMksEncodedConfig, decodeTestConfig } from "../fixtures.ts"
import { spyDnsLayer as _spyDnsLayer } from "./spy-dns.ts"

const _recordsConfig = (records: ReadonlyArray<{ readonly name: string; readonly target: string }>) =>
  decodeTestConfig({ ...baseMksEncodedConfig, name: "c1", dns: { module: "hetzner", zone: "example.com", ttl: 300, records } })

const _config = _recordsConfig([{ name: "api", target: "api_server" }])
const _withIngress = _recordsConfig([{ name: "api", target: "api_server" }, { name: "www", target: "ingress" }])
const _ENDPOINT = "https://abc123.eu-west-1.mks.ovh.net"

it.effect("maps the MKS apiEndpoint to the api_server record's hostname", () =>
  Effect.gen(function*() {
    const spy = _spyDnsLayer()
    yield* reconcileMksDns({ config: _config, apiEndpoint: "https://abc123.eu-west-1.mks.ovh.net" }).pipe(Effect.provide(spy.layer))
    assert.deepStrictEqual(spy.ensured, [[
      { name: "api", target: "abc123.eu-west-1.mks.ovh.net" },
      { name: "api", target: "kumulo.cluster=c1" }
    ]])
  }))

// R15 — the ingress record points at the address kumulo allocated, not at a
// hostname it had to discover (D2). A floating IP is IPv4, so the provider
// classifies it as an A record with no further hint.
it.effect("points an ingress record at the ingress LB's floating IP", () =>
  Effect.gen(function*() {
    const spy = _spyDnsLayer()
    yield* reconcileMksDns({
      config: _withIngress,
      apiEndpoint: _ENDPOINT,
      ingress: { id: "lb-1", vip: "10.0.2.7", floatingIp: "203.0.113.1" }
    }).pipe(Effect.provide(spy.layer))
    assert.deepStrictEqual(spy.ensured, [[
      { name: "api", target: "abc123.eu-west-1.mks.ovh.net" },
      { name: "www", target: "203.0.113.1" },
      { name: "api", target: "kumulo.cluster=c1" },
      { name: "www", target: "kumulo.cluster=c1" }
    ]])
  }))

// No LB (no `ingress` block, or one whose floating IP never materialised) is
// the unresolved case: R15 keeps it a literal pass-through rather than
// inventing an address.
it.effect("leaves an ingress record literal when there is no ingress LB", () =>
  Effect.gen(function*() {
    const spy = _spyDnsLayer()
    yield* reconcileMksDns({ config: _withIngress, apiEndpoint: _ENDPOINT }).pipe(Effect.provide(spy.layer))
    yield* reconcileMksDns({ config: _withIngress, apiEndpoint: _ENDPOINT, ingress: { id: "lb-1", vip: "10.0.2.7" } }).pipe(
      Effect.provide(spy.layer)
    )
    assert.deepStrictEqual(spy.ensured.map((records) => records[1]), [
      { name: "www", target: "ingress" },
      { name: "www", target: "ingress" }
    ])
  }))

it.effect("an empty apiEndpoint fails instead of silently skipping DNS", () =>
  Effect.gen(function*() {
    const spy = _spyDnsLayer()
    const failure = yield* reconcileMksDns({ config: _config, apiEndpoint: "" }).pipe(Effect.provide(spy.layer), Effect.flip)
    assert.strictEqual(failure._tag, "ConfigInvalid")
    assert.deepStrictEqual(spy.ensured, [])
  }))

it.effect("delete removes the cluster-owned DNS records", () =>
  Effect.gen(function*() {
    const spy = _spyDnsLayer()
    const server = makeFakeMksServer()
    const mksEnvLayer = Layer.succeed(MksEnv, { mks: makeMksClient(server.httpClient), serviceName: "service-1" })
    yield* deleteMksEffect(_config).pipe(Effect.provide(spy.layer), Effect.provide(mksEnvLayer))
    assert.deepStrictEqual(spy.removed, ["c1"])
  }))
