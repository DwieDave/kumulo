import { assert, describe, it } from "@effect/vitest"
import { Effect, Predicate, Redacted } from "effect"
import * as Fiber from "effect/Fiber"
import { TestClock } from "effect/testing"
import { makeGodaddyDnsClient } from "../../src/client/godaddy-dns.ts"
import { makeGodaddyHttpClient } from "../../src/transport/http-client.ts"
import { makeGodaddyDnsProvider } from "../../src/provider/dns-provider.ts"
import { makeFakeZone } from "./fake-zone.ts"
import { runDnsProviderContractSuite } from "./contract.ts"

const _zone = "example.com"

const _rel = (subDomain: string): string => subDomain.replace(/\.example\.com$/, "")

const _owner = (name: string, tag = "cluster-a") => ({ name, target: `kumulo.cluster=${tag}` })

describe("godaddy dns provider - port contract", () => {
  runDnsProviderContractSuite(() => {
    const fake = makeFakeZone({ zone: _zone })

    return {
      zone: _zone,
      provider: makeGodaddyDnsProvider({ dns: fake.dns }),
      targetOf: (subDomain) => fake.peek({ name: _rel(subDomain), type: "A" })?.data
        ?? fake.peek({ name: _rel(subDomain), type: "CNAME" })?.data,
      seedForeign: (subDomain, target) => fake.seed({ name: _rel(subDomain), type: "A", data: target }),
      seedForeignKind: (subDomain, fieldType, target) => fake.seed({ name: _rel(subDomain), type: fieldType, data: target }),
      seedForeignOwnerTxt: (subDomain, tag) => fake.seed({ name: _rel(subDomain), type: "TXT", data: `kumulo.cluster=${tag}` }),
      kindsAt: (subDomain) => fake.peekAll().flatMap((r) => r.name === _rel(subDomain) ? [r.type] : []).toSorted()
    }
  })
})

const _setup = () => {
  const fake = makeFakeZone({ zone: _zone })

  return { fake, provider: makeGodaddyDnsProvider({ dns: fake.dns }) }
}

describe("godaddy dns provider - specifics", () => {
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

  it.effect("rejects an apex record that resolves to a hostname before any request", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()

      const error = yield* Effect.flip(
        provider.ensureRecords(_zone, [_owner("@"), { name: "@", target: "k8s.upcloud.example.net" }])
      )

      assert.isTrue(Predicate.isTagged(error, "ProviderApiError"))
      assert.strictEqual(fake.requests().length, 0)
    }))

  it.effect("allows an apex record that resolves to an IP", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()

      yield* provider.ensureRecords(_zone, [_owner("@"), { name: "@", target: "203.0.113.9" }])

      assert.strictEqual(fake.peek({ name: "@", type: "A" })?.data, "203.0.113.9")
    }))

  it.effect("replaces by id on ttl drift", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const owner = fake.seed({ name: "api", type: "TXT", data: "kumulo.cluster=cluster-a", ttl: 600 })
      const a = fake.seed({ name: "api", type: "A", data: "10.0.0.1", ttl: 1800 })
      yield* provider.ensureRecords(_zone, [_owner("api.example.com"), { name: "api.example.com", target: "10.0.0.1" }])
      const writes = fake.writes()
      assert.strictEqual(writes.length, 1)
      assert.strictEqual(writes[0]?.method, "PUT")
      assert.isTrue(writes[0]?.path.endsWith(a.recordId))
      assert.strictEqual(fake.peek({ name: "api", type: "A" })?.ttl, 600)
      assert.strictEqual(fake.peek({ name: "api", type: "TXT" })?.recordId, owner.recordId)
    }))

  it.effect("kind change deletes before it creates", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const owner = _owner("www.example.com")
      yield* provider.ensureRecords(_zone, [owner, { name: "www.example.com", target: "lb.example.net" }])
      const start = fake.writes().length
      yield* provider.ensureRecords(_zone, [owner, { name: "www.example.com", target: "203.0.113.1" }])
      const methods = fake.writes().slice(start).map((r) => r.method)
      assert.deepStrictEqual(methods, ["DELETE", "POST"])
    }))

  it.effect("empty, @ and zone name all mean the apex", () =>
    Effect.gen(function*() {
      for (const name of ["", "@", "example.com"]) {
        const { fake, provider } = _setup()
        yield* provider.ensureRecords(_zone, [_owner(name), { name, target: "10.0.0.1" }])
        assert.strictEqual(fake.peek({ name: "@", type: "A" })?.data, "10.0.0.1")
        assert.strictEqual(fake.peek({ name: "@", type: "TXT" })?.data, "kumulo.cluster=cluster-a")
      }
    }))

  it.effect("collapses owned duplicates to one record", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      fake.seed({ name: "api", type: "TXT", data: "kumulo.cluster=cluster-a" })
      fake.seed({ name: "api", type: "A", data: "10.0.0.1" })
      fake.seed({ name: "api", type: "A", data: "10.0.0.7" })
      yield* provider.ensureRecords(_zone, [_owner("api.example.com"), { name: "api.example.com", target: "10.0.0.1" }])
      const as = fake.peekAll().filter((r) => r.type === "A")
      assert.strictEqual(as.length, 1)
      assert.strictEqual(as[0]?.data, "10.0.0.1")
    }))

  it.effect("accepts quoted TXT ownership without rewriting", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      fake.seed({ name: "api", type: "TXT", data: "\"kumulo.cluster=cluster-a\"", ttl: 600 })
      fake.seed({ name: "api", type: "A", data: "10.0.0.1", ttl: 600 })
      yield* provider.ensureRecords(_zone, [_owner("api.example.com"), { name: "api.example.com", target: "10.0.0.1" }])
      assert.strictEqual(fake.writes().length, 0)
    }))

  it.effect("never touches NS, SOA, MX or SPF TXT, including on removal", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      fake.seedProtected()
      const before = fake.peekAll()
      const desired = [_owner("example.com"), { name: "example.com", target: "10.0.0.1" }]
      yield* provider.ensureRecords(_zone, desired)
      yield* provider.removeClusterRecords(_zone, "cluster-a")
      assert.deepStrictEqual(fake.peekAll(), before)
      assert.isTrue(fake.writes().every((w) => w.method !== "PUT"))
    }))

  it.effect("foreign A and another cluster's TXT give ResourceConflict", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      fake.seed({ name: "a", type: "A", data: "9.9.9.9" })
      fake.seed({ name: "b", type: "TXT", data: "kumulo.cluster=other" })
      const one = yield* Effect.flip(provider.ensureRecords(_zone, [_owner("a.example.com"), { name: "a.example.com", target: "10.0.0.1" }]))
      const two = yield* Effect.flip(provider.ensureRecords(_zone, [_owner("b.example.com"), { name: "b.example.com", target: "10.0.0.1" }]))
      assert.strictEqual(one._tag, "ResourceConflict")
      assert.strictEqual(two._tag, "ResourceConflict")
      assert.strictEqual(fake.writes().length, 0)
    }))

  it.effect("stays within the request budget for a 10-record cluster", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const names = Array.from({ length: 10 }, (_, i) => `h${i}.example.com`)
      const desired = names.flatMap((name) => [_owner(name), { name, target: "10.0.0.1" }])
      yield* provider.ensureRecords(_zone, desired)
      assert.strictEqual(fake.requests().length, 1 + 20)
      assert.strictEqual(fake.requests().filter((r) => r.method === "GET").length, 1)
      const before = fake.requests().length
      yield* provider.ensureRecords(_zone, desired)
      assert.strictEqual(fake.requests().length - before, 1)
      assert.strictEqual(fake.writes().length, 20)
    }))

  it.effect("removeClusterRecords is idempotent", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      yield* provider.ensureRecords(_zone, [_owner("api.example.com"), { name: "api.example.com", target: "10.0.0.1" }])
      yield* provider.removeClusterRecords(_zone, "cluster-a")
      assert.deepStrictEqual(fake.peekAll(), [])

      const before = fake.writes().length
      yield* provider.removeClusterRecords(_zone, "cluster-a")
      assert.strictEqual(fake.writes().length - before, 0)
    }))

  it.effect("removeClusterRecords skips a name that also carries another cluster's owner TXT", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      fake.seed({ name: "api", type: "TXT", data: "kumulo.cluster=cluster-a" })
      fake.seed({ name: "api", type: "TXT", data: "kumulo.cluster=other" })
      fake.seed({ name: "api", type: "A", data: "10.0.0.1" })
      fake.seed({ name: "web", type: "TXT", data: "kumulo.cluster=cluster-a" })
      fake.seed({ name: "web", type: "A", data: "10.0.0.2" })
      yield* provider.removeClusterRecords(_zone, "cluster-a")
      assert.deepStrictEqual(fake.peekAll().map((r) => r.name).toSorted(), ["api", "api", "api"])
    }))

  it.effect("does not rewrite a dotted, mixed-case CNAME or a non-canonical AAAA", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      fake.seed({ name: "www", type: "TXT", data: "kumulo.cluster=cluster-a", ttl: 600 })
      fake.seed({ name: "www", type: "CNAME", data: "LB.Example.net.", ttl: 600 })
      fake.seed({ name: "v6", type: "TXT", data: "kumulo.cluster=cluster-a", ttl: 600 })
      fake.seed({ name: "v6", type: "AAAA", data: "2001:DB8:0:0:0:0:0:1", ttl: 600 })
      yield* provider.ensureRecords(_zone, [
        _owner("www.example.com"),
        { name: "www.example.com", target: "lb.example.net" },
        _owner("v6.example.com"),
        { name: "v6.example.com", target: "2001:db8::1" }
      ])
      assert.strictEqual(fake.writes().length, 0)
    }))

  it.effect("fails on two desired targets for one name", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()

      const error = yield* Effect.flip(provider.ensureRecords(_zone, [
        _owner("api.example.com"),
        { name: "api.example.com", target: "10.0.0.1" },
        { name: "api.example.com", target: "10.0.0.2" }
      ]))

      assert.strictEqual(error._tag, "ResourceConflict")
      assert.strictEqual(fake.writes().length, 0)
    }))

  it.effect("a desired record without ownership conflicts with an existing owner TXT", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      fake.seed({ name: "api", type: "TXT", data: "kumulo.cluster=cluster-a" })
      const error = yield* Effect.flip(provider.ensureRecords(_zone, [{ name: "api.example.com", target: "10.0.0.1" }]))
      assert.strictEqual(error._tag, "ResourceConflict")
      assert.strictEqual(fake.writes().length, 0)
    }))

  it.effect("recovers on the next reconcile when the create after a kind-change delete fails", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      const owner = _owner("www.example.com")
      yield* provider.ensureRecords(_zone, [owner, { name: "www.example.com", target: "lb.example.net" }])
      fake.failNextCreates(1)
      const exit = yield* Effect.exit(provider.ensureRecords(_zone, [owner, { name: "www.example.com", target: "203.0.113.1" }]))
      assert.strictEqual(exit._tag, "Failure")
      assert.isUndefined(fake.peek({ name: "www", type: "CNAME" }))
      assert.isUndefined(fake.peek({ name: "www", type: "A" }))
      yield* provider.ensureRecords(_zone, [owner, { name: "www.example.com", target: "203.0.113.1" }])
      assert.strictEqual(fake.peek({ name: "www", type: "A" })?.data, "203.0.113.1")
    }))

  it.effect("normalizes uppercase and FQDN names", () =>
    Effect.gen(function*() {
      const { fake, provider } = _setup()
      yield* provider.ensureRecords(_zone, [_owner("WWW.Example.COM"), { name: "WWW.Example.COM", target: "10.0.0.1" }])
      assert.strictEqual(fake.peek({ name: "www", type: "A" })?.data, "10.0.0.1")
      const before = fake.writes().length
      yield* provider.ensureRecords(_zone, [_owner("www.example.com"), { name: "www.example.com", target: "10.0.0.1" }])
      assert.strictEqual(fake.writes().length, before)
    }))

  it.effect("applies a custom ttl", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: _zone })
      const provider = makeGodaddyDnsProvider({ dns: fake.dns, ttl: 900 })
      yield* provider.ensureRecords(_zone, [_owner("api.example.com"), { name: "api.example.com", target: "10.0.0.1" }])
      assert.strictEqual(fake.peek({ name: "api", type: "A" })?.ttl, 900)
      assert.strictEqual(fake.peek({ name: "api", type: "TXT" })?.ttl, 900)
    }))

  it.effect("ensureRecords converges across multiple pages with zero writes on re-apply", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: _zone, pageSize: 2 })
      const provider = makeGodaddyDnsProvider({ dns: fake.dns })
      const desired = ["a", "b", "c"].flatMap((n) => [_owner(`${n}.example.com`), { name: `${n}.example.com`, target: "10.0.0.1" }])
      yield* provider.ensureRecords(_zone, desired)
      const before = fake.writes().length
      yield* provider.ensureRecords(_zone, desired)
      assert.strictEqual(fake.writes().length, before)
      assert.strictEqual(fake.peekAll().length, 6)
    }))
})

const _limited = (options: { readonly retryAfterSeconds: number }) => {
  const fake = makeFakeZone({ zone: _zone, rateLimitAfter: 0, ...options })
  const http = makeGodaddyHttpClient({ base: fake.httpClient, token: Redacted.make("t"), baseUrl: "" })

  return { fake, provider: makeGodaddyDnsProvider({ dns: makeGodaddyDnsClient(http) }) }
}

describe("godaddy dns provider - rate limiting end to end", () => {
  it.effect("retries a 429 and then succeeds", () =>
    Effect.gen(function*() {
      const { fake, provider } = _limited({ retryAfterSeconds: 1 })
      const fiber = yield* Effect.forkChild(provider.ensureRecords(_zone, [_owner("api.example.com"), { name: "api.example.com", target: "10.0.0.1" }]))
      yield* Effect.yieldNow
      fake.setRateLimitAfter(undefined)
      yield* TestClock.adjust(1000)
      yield* Fiber.join(fiber)
      assert.strictEqual(fake.peek({ name: "api", type: "A" })?.data, "10.0.0.1")
    }))

  it.effect("surfaces RateLimited once retries are exhausted", () =>
    Effect.gen(function*() {
      const { provider } = _limited({ retryAfterSeconds: 2 })
      const fiber = yield* Effect.forkChild(Effect.flip(provider.ensureRecords(_zone, [_owner("api.example.com")])))
      yield* Effect.yieldNow
      yield* TestClock.adjust(20_000)
      const error = yield* Fiber.join(fiber)
      assert.strictEqual(error._tag, "RateLimited")
    }))
})
