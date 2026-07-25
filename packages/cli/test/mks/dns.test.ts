import { Effect, Layer } from "effect"
import { assert, it } from "@effect/vitest"
import { DnsProvider } from "@kumulo/core"
import type { DesiredRecord } from "@kumulo/core"
import { deleteMksEffect, reconcileMksDns } from "../../src/mks/reconcile.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { baseMksEncodedConfig, decodeTestConfig } from "../fixtures.ts"

const _config = decodeTestConfig({
  ...baseMksEncodedConfig,
  name: "c1",
  dns: {
    module: "hetzner",
    zone: "example.com",
    ttl: 300,
    records: [{ name: "api", target: "api_server" }]
  }
})

/** Records the calls a `reconcileDns`/`removeDns` run makes against the port. */
const _spyDnsLayer = () => {
  const ensured: Array<ReadonlyArray<DesiredRecord>> = []
  const removed: Array<string> = []
  const layer = Layer.succeed(DnsProvider, {
    ensureRecords: (_zone: string, records: ReadonlyArray<DesiredRecord>) =>
      Effect.sync(() => {
        ensured.push(records)
      }),
    removeClusterRecords: (_zone: string, tag: string) =>
      Effect.sync(() => {
        removed.push(tag)
      })
  })
  return { layer, ensured, removed }
}

it.effect("maps the MKS apiEndpoint to the api_server record's hostname", () =>
  Effect.gen(function*() {
    const spy = _spyDnsLayer()
    yield* reconcileMksDns({ config: _config, apiEndpoint: "https://abc123.eu-west-1.mks.ovh.net" }).pipe(Effect.provide(spy.layer))
    assert.deepStrictEqual(spy.ensured, [[{ name: "api", target: "abc123.eu-west-1.mks.ovh.net" }]])
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
