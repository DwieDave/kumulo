import { assert, describe, it } from "@effect/vitest"
import { Effect, Predicate, Redacted } from "effect"
import * as Fiber from "effect/Fiber"
import { TestClock } from "effect/testing"
import { dnsProviderContract } from "@kumulo/core/testing"
import { makeCloudflareDnsClient } from "../../src/client/cloudflare-dns.ts"
import { makeCloudflareDnsProvider } from "../../src/provider/dns-provider.ts"
import { makeCloudflareHttpClient } from "../../src/transport/http-client.ts"
import { fixtureBaseUrl, makeFakeZone } from "./fake-zone.ts"

const _zone = "example.com"

const _owner = (name: string, tag = "cluster-a") => ({ name, target: `kumulo.cluster=${tag}` })

const _unquote = (content: string): string => content.replace(/^"(.*)"$/, "$1")

describe("cloudflare dns provider - port contract", () => {
  dnsProviderContract(() => {
    const fake = makeFakeZone({ zone: _zone })
    const at = (subDomain: string) => fake.peekAll().filter((r) => r.name === fake.fullName(subDomain))

    return {
      zone: _zone,
      provider: makeCloudflareDnsProvider({ dns: fake.dns }),
      targetOf: (subDomain) => fake.peek({ name: subDomain, type: "A" })?.content ?? fake.peek({ name: subDomain, type: "CNAME" })?.content,
      seedForeign: (subDomain, target) => fake.seed({ name: subDomain, type: "A", content: target }),
      seedForeignKind: (subDomain, fieldType, target) => fake.seed({ name: subDomain, type: fieldType, content: target }),
      seedForeignOwnerTxt: (subDomain, tag) => fake.seed({ name: subDomain, type: "TXT", content: `"kumulo.cluster=${tag}"` }),
      kindsAt: (subDomain) => at(subDomain).map((r) => r.type).toSorted(),
      valuesAt: (subDomain, fieldType) => at(subDomain).flatMap((r) => r.type === fieldType ? [_unquote(r.content)] : []),
      seedForeignTxt: (subDomain, value) => fake.seed({ name: subDomain, type: "TXT", content: `"${value}"` })
    }
  })
})

const _setup = (options: { readonly ttl?: number } = {}) => {
  const fake = makeFakeZone({ zone: _zone })

  return { fake, provider: makeCloudflareDnsProvider({ dns: fake.dns, ttl: options.ttl }) }
}

describe("cloudflare dns provider - specifics", () => {
  it.effect("writes A and CNAME with proxied false and full names, TXT quoted without proxied", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      yield* provider.ensureRecords(_zone, [
        _owner("*.c1"),
        { name: "*.c1", target: "203.0.113.10" },
        _owner("www"),
        { name: "www", target: "lb.example.net" }
      ])

      const posted = fake.writes().map((w) => JSON.parse(w.body))
      const byType = (type: string) => posted.filter((body) => body.type === type)

      assert.deepStrictEqual(byType("A"), [{ type: "A", name: "*.c1.example.com", content: "203.0.113.10", ttl: 600, proxied: false }])
      assert.deepStrictEqual(byType("CNAME"), [{ type: "CNAME", name: "www.example.com", content: "lb.example.net", ttl: 600, proxied: false }])
      assert.deepStrictEqual(byType("TXT").map((body) => body.content), ["\"kumulo.cluster=cluster-a\"", "\"kumulo.cluster=cluster-a\""])
      assert.isTrue(byType("TXT").every((body) => !("proxied" in body)))
    }))

  it.effect("looks the zone up once per provider and then reuses its id", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const desired = [_owner("api"), { name: "api", target: "10.0.0.1" }]
      yield* provider.ensureRecords(_zone, desired)
      yield* provider.ensureRecords(_zone, desired)
      yield* provider.removeClusterRecords(_zone, "cluster-a")
      assert.strictEqual(fake.requests().filter((r) => r.path === "/zones").length, 1)
      assert.include(fake.requests()[0]?.search ?? "", "name=example.com")
    }))

  it.effect("second apply makes one list request and no writes", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const desired = [_owner("api.example.com"), { name: "api.example.com", target: "10.0.0.1" }]
      yield* provider.ensureRecords(_zone, desired)
      const before = fake.requests().length
      yield* provider.ensureRecords(_zone, desired)
      assert.strictEqual(fake.requests().length - before, 1)
      assert.strictEqual(fake.writes().length, 2)
    }))

  it.effect("fails with ResourceNotFound naming the token permissions when the zone is not visible", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: _zone, visible: false })
      const provider = makeCloudflareDnsProvider({ dns: fake.dns })
      const error = yield* Effect.flip(provider.ensureRecords(_zone, [_owner("api"), { name: "api", target: "10.0.0.1" }]))
      assert.isTrue(Predicate.isTagged(error, "ResourceNotFound"))

      if (Predicate.isTagged(error, "ResourceNotFound")) {
        assert.include(error.ref, "Zone:Read")
        assert.include(error.ref, "DNS:Edit")
      }

      assert.strictEqual(fake.writes().length, 0)
    }))

  it.effect("rewrites an owned record that someone switched to proxied", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      fake.seed({ name: "api", type: "TXT", content: "\"kumulo.cluster=cluster-a\"", ttl: 600 })
      const a = fake.seed({ name: "api", type: "A", content: "10.0.0.1", ttl: 1, proxied: true })
      yield* provider.ensureRecords(_zone, [_owner("api"), { name: "api", target: "10.0.0.1" }])
      const writes = fake.writes()
      assert.strictEqual(writes.length, 1)
      assert.strictEqual(writes[0]?.method, "PUT")
      assert.isTrue(writes[0]?.path.endsWith(a.id))
      assert.strictEqual(fake.peek({ name: "api", type: "A" })?.proxied, false)
    }))

  it.effect("allows a CNAME at the apex, which Cloudflare flattens", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      yield* provider.ensureRecords(_zone, [_owner("@"), { name: "@", target: "k8s.upcloud.example.net" }])
      assert.strictEqual(fake.peek({ name: "example.com", type: "CNAME" })?.content, "k8s.upcloud.example.net")
    }))

  it.effect("empty, @ and zone name all mean the apex", () =>
    Effect.gen(function*() {
      for (const name of ["", "@", "example.com"]) {
        const { fake, provider } = _setup()
        yield* provider.ensureRecords(_zone, [_owner(name), { name, target: "10.0.0.1" }])
        assert.strictEqual(fake.peek({ name: "example.com", type: "A" })?.content, "10.0.0.1")
        assert.strictEqual(fake.peek({ name: "example.com", type: "TXT" })?.content, "\"kumulo.cluster=cluster-a\"")
      }
    }))

  it.effect("replaces by id on ttl drift", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const owner = fake.seed({ name: "api", type: "TXT", content: "\"kumulo.cluster=cluster-a\"", ttl: 600 })
      const a = fake.seed({ name: "api", type: "A", content: "10.0.0.1", ttl: 1800 })
      yield* provider.ensureRecords(_zone, [_owner("api"), { name: "api", target: "10.0.0.1" }])
      const writes = fake.writes()
      assert.strictEqual(writes.length, 1)
      assert.strictEqual(writes[0]?.method, "PUT")
      assert.isTrue(writes[0]?.path.endsWith(a.id))
      assert.strictEqual(fake.peek({ name: "api", type: "A" })?.ttl, 600)
      assert.strictEqual(fake.peek({ name: "api", type: "TXT" })?.id, owner.id)
    }))

  it.effect("kind change deletes before it creates", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const owner = _owner("www")
      yield* provider.ensureRecords(_zone, [owner, { name: "www", target: "lb.example.net" }])
      const start = fake.writes().length
      yield* provider.ensureRecords(_zone, [owner, { name: "www", target: "203.0.113.1" }])
      assert.deepStrictEqual(fake.writes().slice(start).map((r) => r.method), ["DELETE", "POST"])
    }))

  it.effect("accepts unquoted TXT ownership written by hand without rewriting", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      fake.seed({ name: "api", type: "TXT", content: "kumulo.cluster=cluster-a", ttl: 600 })
      fake.seed({ name: "api", type: "A", content: "10.0.0.1", ttl: 600 })
      yield* provider.ensureRecords(_zone, [_owner("api"), { name: "api", target: "10.0.0.1" }])
      assert.strictEqual(fake.writes().length, 0)
    }))

  it.effect("does not rewrite a dotted, mixed-case CNAME or a non-canonical AAAA", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      fake.seed({ name: "www", type: "TXT", content: "\"kumulo.cluster=cluster-a\"", ttl: 600 })
      fake.seed({ name: "www", type: "CNAME", content: "LB.Example.net.", ttl: 600 })
      fake.seed({ name: "v6", type: "TXT", content: "\"kumulo.cluster=cluster-a\"", ttl: 600 })
      fake.seed({ name: "v6", type: "AAAA", content: "2001:DB8:0:0:0:0:0:1", ttl: 600 })
      yield* provider.ensureRecords(_zone, [
        _owner("www"),
        { name: "www", target: "lb.example.net" },
        _owner("v6"),
        { name: "v6", target: "2001:db8::1" }
      ])
      assert.strictEqual(fake.writes().length, 0)
    }))

  it.effect("never touches MX or SPF TXT, including on removal", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      fake.seed({ name: "@", type: "MX", content: "mail.example.com" })
      fake.seed({ name: "@", type: "TXT", content: "\"v=spf1 include:_spf.example.com ~all\"" })
      const before = fake.peekAll()
      yield* provider.ensureRecords(_zone, [_owner("example.com"), { name: "example.com", target: "10.0.0.1" }])
      yield* provider.removeClusterRecords(_zone, "cluster-a")
      assert.deepStrictEqual(fake.peekAll(), before)
    }))

  it.effect("normalizes uppercase and FQDN names", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      yield* provider.ensureRecords(_zone, [_owner("WWW.Example.COM"), { name: "WWW.Example.COM", target: "10.0.0.1" }])
      assert.strictEqual(fake.peek({ name: "www", type: "A" })?.content, "10.0.0.1")
      const before = fake.writes().length
      yield* provider.ensureRecords(_zone, [_owner("www"), { name: "www", target: "10.0.0.1" }])
      assert.strictEqual(fake.writes().length, before)
    }))

  it.effect("applies a custom ttl, including 1 for automatic", () =>
    Effect.gen(function*() {
      for (const ttl of [1, 300]) {
        const { fake, provider } = _setup({ ttl })
        yield* provider.ensureRecords(_zone, [_owner("api"), { name: "api", target: "10.0.0.1" }])
        assert.strictEqual(fake.peek({ name: "api", type: "A" })?.ttl, ttl)
        assert.strictEqual(fake.peek({ name: "api", type: "TXT" })?.ttl, ttl)
      }
    }))

  it.effect("converges across pages, and without result_info, with zero writes on re-apply", () =>
    Effect.gen(function*() {
      for (const omitResultInfo of [false, true]) {
        const fake = makeFakeZone({ zone: _zone, pageSize: 2, omitResultInfo })
        const provider = makeCloudflareDnsProvider({ dns: fake.dns })
        const desired = ["a", "b", "c"].flatMap((n) => [_owner(n), { name: n, target: "10.0.0.1" }])
        yield* provider.ensureRecords(_zone, desired)
        const before = fake.writes().length
        yield* provider.ensureRecords(_zone, desired)
        assert.strictEqual(fake.writes().length, before)
        assert.strictEqual(fake.peekAll().length, 6)
      }
    }))

  it.effect("recovers on the next reconcile when the create after a kind-change delete fails", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const owner = _owner("www")
      yield* provider.ensureRecords(_zone, [owner, { name: "www", target: "lb.example.net" }])
      fake.failNextCreates(1)
      const exit = yield* Effect.exit(provider.ensureRecords(_zone, [owner, { name: "www", target: "203.0.113.1" }]))
      assert.strictEqual(exit._tag, "Failure")
      yield* provider.ensureRecords(_zone, [owner, { name: "www", target: "203.0.113.1" }])
      assert.strictEqual(fake.peek({ name: "www", type: "A" })?.content, "203.0.113.1")
      assert.isUndefined(fake.peek({ name: "www", type: "CNAME" }))
    }))

  it.effect("removeClusterRecords is idempotent", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      yield* provider.ensureRecords(_zone, [_owner("api"), { name: "api", target: "10.0.0.1" }])
      yield* provider.removeClusterRecords(_zone, "cluster-a")
      assert.deepStrictEqual(fake.peekAll(), [])
      const before = fake.writes().length
      yield* provider.removeClusterRecords(_zone, "cluster-a")
      assert.strictEqual(fake.writes().length - before, 0)
    }))
})

const _limited = (options: { readonly retryAfterSeconds: number }) =>
  Effect.gen(function*() {
    const fake = makeFakeZone({ zone: _zone, rateLimitAfter: 0, ...options })
    const http = yield* makeCloudflareHttpClient({ base: fake.httpClient, token: Redacted.make("t"), baseUrl: fixtureBaseUrl })

    return { fake, provider: makeCloudflareDnsProvider({ dns: makeCloudflareDnsClient(http) }) }
  })

describe("cloudflare dns provider - rate limiting end to end", () => {
  it.effect("retries a 429 and then succeeds", () =>
    Effect.gen(function*() {
      const { fake, provider } = yield* _limited({ retryAfterSeconds: 1 })
      const fiber = yield* Effect.forkChild(provider.ensureRecords(_zone, [_owner("api"), { name: "api", target: "10.0.0.1" }]))
      yield* Effect.yieldNow
      fake.setRateLimitAfter(undefined)
      yield* TestClock.adjust(1000)
      yield* Fiber.join(fiber)
      assert.strictEqual(fake.peek({ name: "api", type: "A" })?.content, "10.0.0.1")
    }))

  it.effect("surfaces RateLimited once retries are exhausted", () =>
    Effect.gen(function*() {
      const { provider } = yield* _limited({ retryAfterSeconds: 2 })
      const fiber = yield* Effect.forkChild(Effect.flip(provider.ensureRecords(_zone, [_owner("api")])))
      yield* Effect.yieldNow
      yield* TestClock.adjust(20_000)
      const error = yield* Fiber.join(fiber)
      assert.strictEqual(error._tag, "RateLimited")
    }))
})
