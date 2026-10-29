import { Duration, Effect, Layer, Ref } from "effect"
import { layerNoop } from "effect/FileSystem"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import { assert, describe, it } from "@effect/vitest"
import { AuthenticationFailed, PlanAction, ProviderApiError } from "@kumulo/core"
import { makeBunnyPullZoneClient } from "@kumulo/bunny"
import { cdnOutputsPath, parseCdnOutputsYaml } from "@kumulo/cdn-bunny"
import type { CdnHandle } from "../src/cdn.ts"
import { fakeCredentials } from "./commands/fake-credentials.ts"
import { decodeK3sTestConfig, baseEncodedConfig } from "./fixtures.ts"
import { applyCdn, cdnDeletePlanActions, cdnHandleFor, cdnPlanActions, cdnStatusLines, removeCdn } from "../src/cdn.ts"
import type { DnsTarget } from "../src/dns.ts"
import { desiredRecords } from "../src/dns.ts"
import { dnsPlanActions } from "../src/dns-plan.ts"
import { makeFakeCdn, resumeFakeCdn } from "./cdn-fakes.ts"

const _shield = {
  plan: "advanced",
  waf: { enabled: true, mode: "log" },
  ddos: { sensitivity: "medium" },
  bot_detection: { mode: "log", sensitivity: "low" },
  rate_limits: [{ name: "login", path_prefix: "/login", requests: 20, window: 60, block_for: 300, key: "ip" }],
  access_lists: [{ name: "office", type: "cidr", action: "allow", entries: ["198.51.100.0/24"] }]
} as const

interface CdnOverrides {
  readonly tier?: "volume"
  readonly hostnames?: Array<string>
  readonly shield?: typeof _shield
}

const _config = (cdn: CdnOverrides = {}) =>
  decodeK3sTestConfig({
    ...baseEncodedConfig,
    dns: { module: "hetzner", zone: "example.com", ttl: 300, records: [{ name: "app", target: "cdn" }] },
    cdn: {
      module: "bunny",
      name: "stagingeu",
      origin: { url: "https://203.0.113.10" },
      hostnames: ["app.example.com"],
      ...cdn
    }
  })

const _apply = (fake: ReturnType<typeof makeFakeCdn>, config = _config()) => {
  const calls: Array<string> = []
  const targets: Array<DnsTarget | undefined> = []

  const effect = applyCdn({
    config,
    cdn: fake.handle,
    dns: (given) =>
      Effect.sync(() => {
        calls.push(`dns:zones=${fake.pullZone.zones().length}`)
        targets.push(given.cdn)
      })
  })

  return { calls, targets, effect }
}

describe("applyCdn", () => {
  it.effect("creates the pull zone before DNS, hands DNS the system hostname, then records outputs", () =>
    Effect.gen(function*() {
      const fake = makeFakeCdn()
      fake.pullZone.setDnsReady("app.example.com", true)
      const run = _apply(fake)
      yield* run.effect
      assert.deepStrictEqual(run.calls, ["dns:zones=1"])
      assert.deepStrictEqual(run.targets, [{ kind: "hostname", value: "stagingeu.b-cdn.net" }])
      const file = yield* Ref.get(fake.state)
      assert.strictEqual(file.systemHostname, "stagingeu.b-cdn.net")
      assert.strictEqual(file.pullZoneId, fake.pullZone.zones()[0]?.Id)
      assert.ok(fake.persisted.length >= 2)
      assert.strictEqual(fake.pullZone.zones()[0]?.Hostnames.find((h) => h.Value === "app.example.com")?.ForceSSL, true)
    }))

  it.effect("applies shield after certificates and is idempotent", () =>
    Effect.gen(function*() {
      const fake = makeFakeCdn()
      fake.pullZone.setDnsReady("app.example.com", true)
      const config = _config({ shield: _shield })
      yield* _apply(fake, config).effect
      assert.strictEqual(fake.shield.zones().length, 1)
      assert.strictEqual(fake.shield.rateLimits().length, 1)
      const before = fake.shield.writes()
      const writes = fake.pullZone.requests().filter((r) => !r.startsWith("GET") && !r.includes("checkavailability")).length
      yield* _apply(resumeFakeCdn(fake), config).effect
      assert.strictEqual(fake.shield.writes(), before)
      assert.strictEqual(fake.pullZone.requests().filter((r) => !r.startsWith("GET") && !r.includes("checkavailability")).length, writes)
    }))

  it.live("a certificate timeout becomes a warning, not a failure", () =>
    Effect.gen(function*() {
      const fake = makeFakeCdn({ certificateTimeout: Duration.millis(60) })
      yield* _apply(fake).effect
      const warnings = yield* Ref.get(fake.warnings)
      assert.strictEqual(warnings.length, 1)
      assert.match(warnings[0] ?? "", /app\.example\.com/)
      assert.strictEqual(fake.pullZone.zones().length, 1)
    }))

  it.effect("cdn.module none just runs the dns step", () =>
    Effect.gen(function*() {
      const fake = makeFakeCdn()
      const calls: Array<string> = []

      yield* applyCdn({
        config: decodeK3sTestConfig({ ...baseEncodedConfig, cdn: { module: "none" } }),
        cdn: undefined,
        dns: () => Effect.sync(() => void calls.push("dns"))
      })
      assert.deepStrictEqual(calls, ["dns"])
      assert.strictEqual(fake.pullZone.zones().length, 0)
    }))
})

describe("plan rows", () => {
  it.effect("plans creates before the zone exists", () =>
    Effect.gen(function*() {
      const fake = makeFakeCdn()
      const actions = yield* cdnPlanActions({ config: _config({ shield: _shield }), cdn: fake.handle })
      assert.deepStrictEqual(actions.map((a) => `${a._tag} ${a.name}`), [
        "Create cdn/stagingeu",
        "Create cdn/stagingeu/hostname/app.example.com",
        "Create cdn/stagingeu/shield",
        "Create cdn/stagingeu/shield/rate-limit/login",
        "Create cdn/stagingeu/shield/access-list/office"
      ])
    }))

  it.effect("plans NoOp after apply and Update when a hostname is added", () =>
    Effect.gen(function*() {
      const fake = makeFakeCdn()
      fake.pullZone.setDnsReady("app.example.com", true)
      const config = _config({ shield: _shield })
      yield* _apply(fake, config).effect
      const settled = yield* cdnPlanActions({ config, cdn: fake.handle })
      assert.ok(settled.every(PlanAction.$is("NoOp")), JSON.stringify(settled))

      const grown = yield* cdnPlanActions({
        config: _config({ shield: _shield, hostnames: ["app.example.com", "api.example.com"] }),
        cdn: fake.handle
      })

      assert.ok(PlanAction.$is("Update")(grown[0]))
      assert.ok(grown.some((a) => PlanAction.$is("Create")(a) && a.name.endsWith("hostname/api.example.com")))
    }))

  it.effect("a tier change needs confirmation", () =>
    Effect.gen(function*() {
      const fake = makeFakeCdn()
      fake.pullZone.setDnsReady("app.example.com", true)
      yield* _apply(fake).effect
      const actions = yield* cdnPlanActions({ config: _config({ tier: "volume" }), cdn: fake.handle })
      assert.strictEqual(actions[0]?._tag, "ReplaceNeedsConfirm")
    }))

  it.effect("emits nothing for cdn none", () =>
    Effect.gen(function*() {
      const actions = yield* cdnPlanActions({ config: decodeK3sTestConfig(baseEncodedConfig), cdn: undefined })
      assert.deepStrictEqual(actions, [])
    }))
})

describe("delete", () => {
  it.effect("removes dns first, resets shield, deletes the pull zone", () =>
    Effect.gen(function*() {
      const fake = makeFakeCdn()
      fake.pullZone.setDnsReady("app.example.com", true)
      const config = _config({ shield: _shield })
      yield* _apply(fake, config).effect
      const rows = yield* cdnDeletePlanActions({ config, cdn: fake.handle })
      assert.deepStrictEqual(rows.map((a) => `${a._tag} ${a.name}`), [
        "Update cdn/stagingeu/shield",
        "Delete cdn/stagingeu/shield/rate-limit/login",
        "Delete cdn/stagingeu/shield/access-list/office",
        "Delete cdn/stagingeu"
      ])
      const order: Array<string> = []
      yield* removeCdn({ cdn: fake.handle, dns: Effect.sync(() => void order.push(`dns:zones=${fake.pullZone.zones().length}`)) })
      assert.deepStrictEqual(order, ["dns:zones=1"])
      assert.strictEqual(fake.pullZone.zones().length, 0)
      assert.strictEqual(fake.shield.rateLimits().length, 0)
      const file = yield* Ref.get(fake.state)
      assert.strictEqual(file.pullZoneId, undefined)
      const again = yield* cdnDeletePlanActions({ config, cdn: fake.handle })
      assert.strictEqual(again[0]?._tag, "NoOp")
      yield* removeCdn({ cdn: fake.handle, dns: Effect.void })
    }))
})

describe("status", () => {
  it.effect("reports the system hostname and certificate state", () =>
    Effect.gen(function*() {
      const fake = makeFakeCdn()
      fake.pullZone.setDnsReady("app.example.com", true)
      yield* _apply(fake).effect
      const lines = yield* cdnStatusLines({ config: _config(), cdn: fake.handle })
      assert.deepStrictEqual(lines, ["  CDN: stagingeu -> stagingeu.b-cdn.net, hostnames: app.example.com (tls)"])
    }))
})

describe("cdn dns target", () => {
  const config = _config()

  it("resolves to the system hostname as a CNAME row", () => {
    assert.deepStrictEqual(
      dnsPlanActions({ config: { module: "hetzner", zone: "example.com", records: [{ name: "app", target: "cdn" }] }, targets: { api_server: "ip", cdn: "hostname" } }),
      [PlanAction.Create({ name: "dns/example.com/app (CNAME)" })]
    )
    const records = desiredRecords({ config, targets: { api_server: { kind: "ip", value: "1.2.3.4" }, cdn: { kind: "hostname", value: "stagingeu.b-cdn.net" } } })
    assert.deepStrictEqual(records[0], { name: "app", target: "stagingeu.b-cdn.net" })
  })
})

const _relative = (client: HttpClient.HttpClient): HttpClient.HttpClient =>
  client.pipe(
    HttpClient.mapRequest((request) => {
      const url = new URL(request.url)

      return HttpClientRequest.setUrl(request, `${url.pathname}${url.search}`)
    })
  )

const _stale = () =>
  makeFakeCdn({ outputs: { cluster: "staging", pullZoneId: 999, systemHostname: "gone.b-cdn.net", shieldZoneId: 55, rules: {}, lists: {} } })

describe("hardening", () => {
  it.effect("delete tolerates a recorded pull zone that no longer exists", () =>
    Effect.gen(function*() {
      const fake = _stale()
      yield* removeCdn({ cdn: fake.handle, dns: Effect.void })
      const file = yield* Ref.get(fake.state)
      assert.strictEqual(file.pullZoneId, undefined)
      assert.strictEqual(file.shieldZoneId, undefined)
      assert.strictEqual(fake.shield.writes(), 0)
    }))

  it.effect("plan maps a deleted pull zone to create rows", () =>
    Effect.gen(function*() {
      const fake = _stale()
      const actions = yield* cdnPlanActions({ config: _config(), cdn: fake.handle })
      assert.deepStrictEqual(actions.map((a) => `${a._tag} ${a.name}`), [
        "Create cdn/stagingeu",
        "Create cdn/stagingeu/hostname/app.example.com"
      ])
    }))

  it.effect("plan fails with the typed error for auth failures", () =>
    Effect.gen(function*() {
      const fake = _stale()

      const handle: CdnHandle = {
        ...fake.handle,
        provider: { ...fake.handle.provider, describeEdge: () => Effect.fail(new AuthenticationFailed({ hint: "bad key" })) }
      }

      const error = yield* Effect.flip(cdnPlanActions({ config: _config(), cdn: handle }))
      assert.instanceOf(error, AuthenticationFailed)
    }))

  it.effect("plan fails with the typed error for 5xx failures", () =>
    Effect.gen(function*() {
      const fake = _stale()

      const handle: CdnHandle = {
        ...fake.handle,
        provider: {
          ...fake.handle.provider,
          describeEdge: () => Effect.fail(new ProviderApiError({ operation: "get pull zone", status: 503, body: "down" }))
        }
      }

      const error = yield* Effect.flip(cdnPlanActions({ config: _config(), cdn: handle }))
      assert.instanceOf(error, ProviderApiError)
    }))

  it.effect("a certificate failure warns with the hostnames and shield still runs", () =>
    Effect.gen(function*() {
      const fake = makeFakeCdn()

      const handle: CdnHandle = {
        ...fake.handle,
        provider: {
          ...fake.handle.provider,
          ensureCertificates: () => Effect.fail(new ProviderApiError({ operation: "load certificate", status: 400, body: "bad" }))
        }
      }

      yield* applyCdn({ config: _config({ shield: _shield }), cdn: handle, dns: () => Effect.void })
      const warnings = yield* Ref.get(fake.warnings)
      assert.strictEqual(warnings.length, 1)
      assert.match(warnings[0] ?? "", /app\.example\.com/)
      assert.strictEqual(fake.shield.zones().length, 1)
    }))

  it.effect("persists the pull zone id when a later ensureEdge step fails, so the next apply adopts it", () =>
    Effect.gen(function*() {
      const fake = makeFakeCdn()
      const other = makeBunnyPullZoneClient(fake.pullZone.httpClient)
      const squatter = yield* other.createPullZone({ name: "squatter", settings: { type: "Premium", originUrl: "https://198.51.100.1", addHostHeader: false, verifyOriginSSL: false, enableWebSockets: false, enableSmartCache: false, enableHostnameVary: false, disableCookies: true } })
      yield* other.addHostname({ id: squatter.Id, hostname: "app.example.com" })

      const store = new Map<string, string>()

      const fs = layerNoop({
        exists: (path) => Effect.succeed(store.has(path)),
        readFileString: (path) => Effect.succeed(store.get(path) ?? ""),
        writeFileString: (path, data) => Effect.sync(() => void store.set(path, data)),
        makeDirectory: () => Effect.void
      })

      const config = _config()
      const path = cdnOutputsPath({ dir: ".", tag: config.name })

      const handleFor = () =>
        cdnHandleFor({ config, configDir: "." }).pipe(
          Effect.provide(Layer.mergeAll(fs, Layer.succeed(HttpClient.HttpClient, _relative(fake.pullZone.httpClient)), fakeCredentials))
        )

      const first = yield* handleFor()
      assert.ok(first !== undefined)

      const spec = yield* Effect.flip(
        applyCdn({ config, cdn: first, originUrl: "https://203.0.113.10", dns: () => Effect.void })
      )

      assert.ok(spec !== undefined)
      const zone = fake.pullZone.zones().find((z) => z.Name === "stagingeu")
      assert.ok(zone !== undefined)
      const recorded = yield* parseCdnOutputsYaml(store.get(path) ?? "")
      assert.strictEqual(recorded.pullZoneId, zone.Id)

      const second = yield* handleFor()
      assert.ok(second !== undefined)

      const info = yield* second.provider.ensureEdge({
        name: "stagingeu",
        tier: "standard",
        originUrl: "https://203.0.113.10",
        verifyOriginTls: true,
        websockets: false,
        cache: "origin",
        hostnames: [],
        forceSsl: false
      })

      assert.strictEqual(info.ref.id, String(zone.Id))
    }))
})
