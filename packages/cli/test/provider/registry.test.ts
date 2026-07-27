import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import type { HttpClientRequest } from "effect/unstable/http"
import { assert, it } from "@effect/vitest"
import { CloudProvider } from "@kumulo/core"
import type { SecGroupRule } from "@kumulo/core"
import { CloudProviderLive as HcloudCloudProviderLive } from "@kumulo/hetzner"
import { OpenStackEnv } from "../../src/doctor-openstack/env.ts"
import { secGroupRules } from "../../src/k3s/env.ts"
import { k3sCloudProviderLayer } from "../../src/provider/registry.ts"
import { baseEncodedConfig, decodeK3sTestConfig } from "../fixtures.ts"

// Every other test in the suite fakes `CloudProvider` wholesale, so nothing
// asserted what the *real* adapters are handed. These two do.

const _ovhConfig = decodeK3sTestConfig(baseEncodedConfig)
const _hetznerConfig = decodeK3sTestConfig({
  ...baseEncodedConfig,
  provider: "hetzner",
  auth: { method: "api_token", region: "fsn1" }
})

/** Records every outgoing request and replays one canned JSON body. */
const _recordingClient = (
  { body, sink }: { readonly body: unknown; readonly sink: Array<HttpClientRequest.HttpClientRequest> }
): HttpClient.HttpClient =>
  HttpClient.make((request) => {
    sink.push(request)
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), { status: 200 })))
  })

const _openStackEnvLayer = Layer.succeed(OpenStackEnv, {
  keystone: {
    token: Effect.succeed("tok-123"),
    invalidate: Effect.void,
    endpoint: () => Effect.succeed("https://compute.example.com/")
  },
  region: "GRA11",
  unavailableReason: undefined
})

// Blocker 1: without `OpenStackHttpLive` between the generated clients and the
// ambient HttpClient, every OpenStack call ships unauthenticated.
it.effect("openstack CloudProvider sends X-Auth-Token on every request", () =>
  Effect.gen(function*() {
    const seen: Array<HttpClientRequest.HttpClientRequest> = []
    const provider = yield* CloudProvider.pipe(
      Effect.provide(k3sCloudProviderLayer(_ovhConfig)),
      Effect.provide(_openStackEnvLayer),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, _recordingClient({ body: { flavors: [{ id: "f1", name: "b3-16" }] }, sink: seen })))
    )
    const id = yield* provider.resolveFlavor("b3-16")
    assert.strictEqual(id, "f1")
    assert.isAbove(seen.length, 0)
    for (const request of seen) assert.strictEqual(request.headers["x-auth-token"], "tok-123")
  }))

// Blocker 2: the registry must hand every adapter core's neutral
// `SecGroupRule`s — a Hetzner-dialect rule (`direction`/`port`/`sourceCidrs`)
// leaking through here is what `ensureSecurityGroups` cannot decode.
const _isNeutral = (rule: SecGroupRule): boolean =>
  !("direction" in rule) && !("port" in rule) && !("sourceCidrs" in rule) &&
  (rule.portMin === undefined || typeof rule.portMin === "number") &&
  (rule.remoteCidr !== undefined || rule.remoteGroupSelf === true)

it("secGroupRules speaks core's neutral dialect for every provider", () => {
  for (const config of [_ovhConfig, _hetznerConfig]) {
    const rules = secGroupRules(config)
    assert.isAbove(rules.length, 0)
    for (const rule of rules) assert.isTrue(_isNeutral(rule), `not a neutral SecGroupRule: ${JSON.stringify(rule)}`)
  }
  // Hetzner has no security-group self-reference: the builder must resolve it
  // to the cluster network CIDR instead of emitting `remoteGroupSelf`.
  assert.isFalse(secGroupRules(_hetznerConfig).some((rule) => rule.remoteGroupSelf === true))
  assert.isTrue(secGroupRules(_ovhConfig).some((rule) => rule.remoteGroupSelf === true))
})

// ...and the hetzner adapter translates them to hcloud's wire shape, which is
// the half a fake `CloudProvider` can never check.
// The fake has to answer with hcloud's *real* envelopes (and its 201s for the
// create/action endpoints) — the generated client decodes them strictly.
const _created = "2026-01-01T00:00:00+00:00"
const _emptyPage = {
  pagination: { page: 1, per_page: 25, previous_page: null, next_page: null, last_page: 1, total_entries: 0 }
}
const _action = {
  id: 1,
  command: "set_firewall_rules",
  status: "success",
  started: _created,
  finished: _created,
  progress: 100,
  resources: [{ id: 1, type: "firewall" }],
  error: null
}

it.effect("hetzner ensureSecurityGroups posts hcloud-shaped rules", () =>
  Effect.gen(function*() {
    const bodies: Array<{ readonly rules: ReadonlyArray<Record<string, unknown>> }> = []
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        const url = new URL(request.url)
        const text = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""
        if (request.method === "POST" && text.length > 0) {
          const parsed: { readonly rules?: ReadonlyArray<Record<string, unknown>> } = JSON.parse(text)
          if (parsed.rules !== undefined) bodies.push({ rules: parsed.rules })
        }
        const [body, status] = url.pathname.endsWith("/firewalls") && request.method === "GET"
          ? [{ firewalls: [], meta: _emptyPage }, 200]
          : url.pathname.endsWith("/firewalls")
          ? [{ firewall: { id: 1, name: "prod-eu", created: _created, rules: [], applied_to: [] } }, 201]
          : [{ actions: [_action] }, 201]
        return HttpClientResponse.fromWeb(request, new Response(JSON.stringify(body), { status }))
      })
    )
    const provider = yield* CloudProvider.pipe(
      Effect.provide(HcloudCloudProviderLive({ tag: _hetznerConfig.name, location: _hetznerConfig.auth.region })),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, client))
    )
    yield* provider.ensureSecurityGroups({ rules: secGroupRules(_hetznerConfig) })
    const sent = bodies.flatMap((body) => body.rules)
    assert.isAbove(sent.length, 0)
    for (const rule of sent) {
      assert.strictEqual(rule["direction"], "in")
      assert.isArray(rule["source_ips"])
      assert.notStrictEqual(rule["protocol"], "any")
    }
    // The etcd range survives the translation as hcloud's `"2379-2380"` string.
    assert.isTrue(sent.some((rule) => rule["port"] === "2379-2380"))
  }))
