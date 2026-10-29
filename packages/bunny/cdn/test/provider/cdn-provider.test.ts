import { Cause, Duration, Effect, Exit, Fiber, Option } from "effect"
import { TestClock } from "effect/testing"
import { assert, describe, it } from "@effect/vitest"
import { CapabilityMissing, ProviderApiError, ProvisioningTimeout, ResourceConflict } from "@kumulo/core"
import type { EdgeSpec } from "@kumulo/core"
import { makeBunnyPullZoneClient, makeFakePullZoneServer } from "@kumulo/bunny"
import { diffEdge } from "../../src/diff.ts"
import { emptyCdnOutputs, parseCdnOutputsYaml, stringifyCdnOutputs } from "../../src/outputs.ts"
import { makeBunnyCdnProvider } from "../../src/provider/cdn-provider.ts"

const _spec: EdgeSpec = {
  name: "acme",
  tier: "standard",
  originUrl: "https://203.0.113.5",
  verifyOriginTls: false,
  websockets: true,
  cache: "smart",
  hostnames: ["app.example.com", "api.example.com"],
  forceSsl: true
}

const _setup = (ownedId?: number) => {
  const fake = makeFakePullZoneServer()
  const pullZone = makeBunnyPullZoneClient(fake.httpClient)

  return {
    fake,
    pullZone,
    provider: makeBunnyCdnProvider({
      pullZone,
      ownedId,
      certificateTimeout: Duration.minutes(2),
      certificateBaseDelay: Duration.seconds(5)
    })
  }
}

const _writes = (fake: ReturnType<typeof makeFakePullZoneServer>) =>
  fake.requests().filter((entry) => !entry.startsWith("GET") && !entry.includes("checkavailability"))

describe("ensureEdge", () => {
  it.effect("creates the zone with owned settings and hostnames", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const info = yield* provider.ensureEdge(_spec)
      const zone = fake.zones()[0]
      assert.strictEqual(zone?.AddHostHeader, true)
      assert.strictEqual(zone?.EnableHostnameVary, true)
      assert.strictEqual(zone?.DisableCookies, false)
      assert.strictEqual(zone?.EnableSmartCache, true)
      assert.strictEqual(zone?.OriginUrl, "https://203.0.113.5")
      assert.deepStrictEqual([...info.hostnames].toSorted(), ["api.example.com", "app.example.com"])
      assert.strictEqual(info.defaultHostname, "acme.b-cdn.net")
      assert.strictEqual(info.ref.id, String(zone?.Id))
    }))

  it.effect("second apply with the owned id performs zero writes", () =>
    Effect.gen(function*() {
      const first = _setup()
      const info = yield* first.provider.ensureEdge(_spec)
      const before = _writes(first.fake).length
      const again = makeBunnyCdnProvider({ pullZone: first.pullZone, ownedId: Number(info.ref.id) })
      yield* again.ensureEdge(_spec)
      assert.strictEqual(_writes(first.fake).length, before)
    }))

  it.effect("adds and removes custom hostnames, never the system one", () =>
    Effect.gen(function*() {
      const { fake, pullZone, provider } = _setup()
      const info = yield* provider.ensureEdge(_spec)
      const again = makeBunnyCdnProvider({ pullZone, ownedId: Number(info.ref.id) })
      const next = yield* again.ensureEdge({ ..._spec, hostnames: ["app.example.com", "www.example.com"] })
      assert.deepStrictEqual([...next.hostnames].toSorted(), ["app.example.com", "www.example.com"])
      assert.isTrue(fake.zones()[0]?.Hostnames.some((hostname) => hostname.IsSystemHostname))
      const none = yield* again.ensureEdge({ ..._spec, hostnames: [] })
      assert.deepStrictEqual(none.hostnames, [])
      assert.strictEqual(fake.zones()[0]?.Hostnames.length, 1)
    }))

  it.effect("updates drifted origin settings", () =>
    Effect.gen(function*() {
      const { fake, pullZone, provider } = _setup()
      const info = yield* provider.ensureEdge(_spec)
      const again = makeBunnyCdnProvider({ pullZone, ownedId: Number(info.ref.id) })
      yield* again.ensureEdge({ ..._spec, originUrl: "https://198.51.100.9", cache: "origin" })
      assert.strictEqual(fake.zones()[0]?.OriginUrl, "https://198.51.100.9")
      assert.strictEqual(fake.zones()[0]?.EnableSmartCache, false)
    }))

  it.effect("rejects more than 10 hostnames before any write", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const hostnames = Array.from({ length: 11 }, (_, index) => `h${index}.example.com`)
      const exit = yield* Effect.exit(provider.ensureEdge({ ..._spec, hostnames }))
      assert.isTrue(Exit.isFailure(exit))
      const error = Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
      assert.isTrue(error instanceof CapabilityMissing)
      assert.strictEqual(fake.zones().length, 0)
    }))

  it.effect("accepts the hostnames the fake still has room for", () =>
    Effect.gen(function*() {
      const { provider } = _setup()
      const hostnames = Array.from({ length: 9 }, (_, index) => `h${index}.example.com`)
      const info = yield* provider.ensureEdge({ ..._spec, hostnames })
      assert.strictEqual(info.hostnames.length, 9)
    }))

  it.effect("fails with ResourceConflict when the name is taken", () =>
    Effect.gen(function*() {
      const { provider, pullZone } = _setup()
      yield* provider.ensureEdge(_spec)
      const other = makeBunnyCdnProvider({ pullZone })
      const error = yield* Effect.flip(other.ensureEdge(_spec))
      assert.isTrue(error instanceof ResourceConflict)
    }))
})

describe("ensureEdge creation recording", () => {
  it.effect("reports the new pull zone before hostname steps so a later failure keeps the id", () =>
    Effect.gen(function*() {
      const fake = makeFakePullZoneServer()
      const real = makeBunnyPullZoneClient(fake.httpClient)
      const created: Array<number> = []

      const provider = makeBunnyCdnProvider({
        pullZone: { ...real, addHostname: () => Effect.fail(new ProviderApiError({ operation: "x", status: 500, body: "boom" })) },
        onCreated: ({ id }) => Effect.sync(() => void created.push(id))
      })

      const error = yield* Effect.flip(provider.ensureEdge(_spec))
      assert.isTrue(error instanceof ProviderApiError)
      assert.deepStrictEqual(created, fake.zones().map((zone) => zone.Id))
      assert.strictEqual(created.length, 1)
    }))
})

describe("ensureCertificates", () => {
  it.effect("surfaces a permanent 4xx immediately instead of timing out", () =>
    Effect.gen(function*() {
      const fake = makeFakePullZoneServer()
      const real = makeBunnyPullZoneClient(fake.httpClient)
      const attempts: Array<string> = []

      const provider = makeBunnyCdnProvider({
        pullZone: {
          ...real,
          loadFreeCertificate: ({ hostname }) =>
            Effect.sync(() => void attempts.push(hostname)).pipe(
              Effect.andThen(Effect.fail(new ProviderApiError({ operation: "cert", status: 422, body: "invalid" })))
            )
        }
      })

      const info = yield* provider.ensureEdge(_spec)
      const error = yield* Effect.flip(provider.ensureCertificates({ ref: info.ref, hostnames: ["app.example.com"] }))
      assert.isTrue(error instanceof ProviderApiError)
      assert.strictEqual(attempts.length, 1)
    }))

  it.effect("retries until DNS is ready, then forces SSL", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const info = yield* provider.ensureEdge(_spec)

      const fiber = yield* Effect.forkChild(
        provider.ensureCertificatesReport({ ref: info.ref, hostnames: ["app.example.com"] })
      )

      yield* TestClock.adjust("20 seconds")
      assert.isUndefined(fiber.pollUnsafe())
      fake.setDnsReady("app.example.com", true)
      yield* TestClock.adjust("1 minute")
      const statuses = yield* Fiber.join(fiber)
      assert.deepStrictEqual(statuses, [{ hostname: "app.example.com", status: "issued" }])
      const entry = fake.zones()[0]?.Hostnames.find((hostname) => hostname.Value === "app.example.com")
      assert.isTrue(entry?.HasCertificate)
      assert.isTrue(entry?.ForceSSL)
    }))

  it.effect("reports a timeout per hostname and fails the port call", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const info = yield* provider.ensureEdge(_spec)
      fake.setDnsReady("api.example.com", true)

      const report = yield* Effect.forkChild(
        provider.ensureCertificatesReport({ ref: info.ref, hostnames: ["app.example.com", "api.example.com"] })
      )

      yield* TestClock.adjust("3 minutes")
      const statuses = yield* Fiber.join(report)
      assert.deepStrictEqual(
        [...statuses].toSorted((a, b) => a.hostname.localeCompare(b.hostname)),
        [{ hostname: "api.example.com", status: "issued" }, { hostname: "app.example.com", status: "timeout" }]
      )
      const failing = yield* Effect.forkChild(Effect.flip(provider.ensureCertificates({ ref: info.ref, hostnames: ["app.example.com"] })))
      yield* TestClock.adjust("3 minutes")
      const error = yield* Fiber.join(failing)
      assert.isTrue(error instanceof ProvisioningTimeout)
    }))

  it.effect("skips hostnames that already have a certificate", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const info = yield* provider.ensureEdge(_spec)
      fake.setDnsReady("app.example.com", true)
      yield* provider.ensureCertificates({ ref: info.ref, hostnames: ["app.example.com"] })
      const before = fake.requests().length
      yield* provider.ensureCertificates({ ref: info.ref, hostnames: ["app.example.com"] })
      assert.isFalse(fake.requests().slice(before).some((entry) => entry.includes("loadFreeCertificate")))
    }))
})

describe("describeEdge and deleteEdge", () => {
  it.effect("describes the current edge and tracks certificate status", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const info = yield* provider.ensureEdge(_spec)
      fake.setDnsReady("app.example.com", true)
      yield* provider.ensureCertificates({ ref: info.ref, hostnames: ["app.example.com"] }).pipe(
        Effect.forkChild,
        Effect.flatMap((fiber) => TestClock.adjust("3 minutes").pipe(Effect.andThen(Fiber.await(fiber))))
      )
      const described = yield* provider.describeEdge(info.ref)
      assert.deepStrictEqual(described.certificatesIssued, ["app.example.com"])
      assert.strictEqual(diffEdge({ spec: _spec, info: described }), "Unchanged")
      assert.strictEqual(diffEdge({ spec: { ..._spec, hostnames: [..._spec.hostnames] }, info }), "Unchanged")
      assert.strictEqual(diffEdge({ spec: { ..._spec, tier: "volume" }, info }), "ReplaceNeedsConfirm")
      assert.strictEqual(diffEdge({ spec: { ..._spec, name: "other" }, info }), "ReplaceNeedsConfirm")
      assert.strictEqual(diffEdge({ spec: { ..._spec, originUrl: "https://x" }, info }), "Update")
    }))

  it.effect("deletes the zone and tolerates a missing one", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const info = yield* provider.ensureEdge(_spec)
      yield* provider.deleteEdge(info.ref)
      assert.strictEqual(fake.zones().length, 0)
      yield* provider.deleteEdge(info.ref)
    }))
})

describe("outputs", () => {
  it.effect("round-trips the cdn outputs file", () =>
    Effect.gen(function*() {
      const file = { ...emptyCdnOutputs("stg"), pullZoneId: 7, systemHostname: "acme.b-cdn.net", shieldZoneId: 3, rules: { login: 11 }, lists: { office: 5 } }
      const parsed = yield* parseCdnOutputsYaml(stringifyCdnOutputs({ file }))
      assert.deepStrictEqual(parsed, file)
      const json = yield* parseCdnOutputsYaml(stringifyCdnOutputs({ file, format: "json" }))
      assert.deepStrictEqual(json, file)
    }))
})

const _flags = (fake: ReturnType<typeof makeFakePullZoneServer>) =>
  fake.zones()[0]?.Hostnames.filter((h) => !h.IsSystemHostname).map((h) => h.ForceSSL)

describe("force ssl", () => {
  const _hostnames = ["app.example.com"]

  it.effect("flips force ssl in both directions and is idempotent", () =>
    Effect.gen(function*() {
      const { fake, pullZone, provider } = _setup()
      const spec = { ..._spec, hostnames: _hostnames }
      fake.setDnsReady("app.example.com", true)
      const info = yield* provider.ensureEdge(spec)
      yield* provider.ensureCertificates({ ref: info.ref, hostnames: _hostnames })
      assert.deepStrictEqual(_flags(fake), [true])

      const off = makeBunnyCdnProvider({ pullZone, ownedId: Number(info.ref.id) })
      yield* off.ensureEdge({ ...spec, forceSsl: false })
      yield* off.ensureCertificates({ ref: info.ref, hostnames: _hostnames })
      assert.deepStrictEqual(_flags(fake), [false])

      const before = fake.requests().filter((entry) => entry.includes("setForceSSL")).length
      yield* off.ensureCertificates({ ref: info.ref, hostnames: _hostnames })
      assert.strictEqual(fake.requests().filter((entry) => entry.includes("setForceSSL")).length, before)

      yield* off.ensureEdge({ ...spec, forceSsl: true })
      yield* off.ensureCertificates({ ref: info.ref, hostnames: _hostnames })
      assert.deepStrictEqual(_flags(fake), [true])
    }))
})
