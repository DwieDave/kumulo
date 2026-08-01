import { Effect } from "effect"
import { assert, it } from "@effect/vitest"
import { decodeUpcloudTestConfig } from "../fixtures.ts"
import { validUpcloudUksConfig } from "../config/fixtures.ts"
import { reconcileUpcloudDns } from "../../src/upcloud/reconcile.ts"
import { spyDnsLayer } from "../mks/spy-dns.ts"

const _kubeconfig = {
  content: [
    "apiVersion: v1",
    "clusters:",
    "  - cluster:",
    "      server: https://abc123.upcloud.k8s.io:6443",
    "    name: uks",
    "users:",
    "  - name: uks",
    "    user:",
    "      token: shhh"
  ].join("\n")
}

const _withZone = decodeUpcloudTestConfig({
  ...validUpcloudUksConfig,
  dns: {
    module: "hetzner",
    zone: "example.com",
    ttl: 300,
    records: [{ name: "api.staging", target: "api_server" }]
  }
})

// D4 approved dns.module for this distro, so it has to actually write records.
// UKS states its endpoint nowhere except the kubeconfig, so that is where the
// api_server hostname comes from — mks parses `apiEndpoint`, which UKS lacks.
it.effect("writes an api_server record pointing at the kubeconfig's server hostname", () =>
  Effect.gen(function*() {
    const spy = spyDnsLayer()
    yield* reconcileUpcloudDns({ config: _withZone, kubeconfig: _kubeconfig }).pipe(Effect.provide(spy.layer))
    assert.strictEqual(spy.ensured.length, 1)
    const record = spy.ensured[0]?.find((entry) => entry.name === "api.staging")
    assert.isDefined(record)
    assert.strictEqual(record?.target, "abc123.upcloud.k8s.io")
  }))

it.effect("writes nothing when dns.module is none", () =>
  Effect.gen(function*() {
    const spy = spyDnsLayer()
    const config = decodeUpcloudTestConfig(validUpcloudUksConfig)
    yield* reconcileUpcloudDns({ config, kubeconfig: _kubeconfig }).pipe(Effect.provide(spy.layer))
    assert.strictEqual(spy.ensured.length, 0)
  }))

it.effect("fails loudly when the kubeconfig has no usable server host, rather than skipping DNS", () =>
  Effect.gen(function*() {
    const spy = spyDnsLayer()
    const broken = { content: _kubeconfig.content.replace("https://abc123.upcloud.k8s.io:6443", "not-a-url") }
    const result = yield* Effect.result(
      reconcileUpcloudDns({ config: _withZone, kubeconfig: broken }).pipe(Effect.provide(spy.layer))
    )
    assert.strictEqual(result._tag, "Failure")
    assert.strictEqual(spy.ensured.length, 0)
  }))
