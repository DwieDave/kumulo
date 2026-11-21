import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { ProviderApiError } from "../../src/errors/tagged.ts"
import { reconcileDns } from "../../src/dns/index.ts"
import type { DnsAdapter, ZoneRecord } from "../../src/dns/index.ts"
import { dnsProviderContract } from "../../src/testing/index.ts"

const _ZONE = "example.com"

const _unquote = (v: string): string => v.length >= 2 && v.startsWith("\"") && v.endsWith("\"") ? v.slice(1, -1) : v

const _build = () => {
  let nextId = 0
  let rows: Array<ZoneRecord> = []
  const calls: Array<string> = []

  const seed = (name: string, type: string, value: string) => {
    rows.push({ id: String(nextId++), name, type, value, ttl: 600 })
  }

  // RFC 1034 3.6.2, as strict providers enforce it: a CNAME shares its name with nothing.
  const _clash = (record: ZoneRecord): boolean =>
    rows.some((r) => r.name === record.name && (r.type === "CNAME" || record.type === "CNAME"))

  const adapter: DnsAdapter = {
    list: () => Effect.succeed(rows.map((r) => ({ ...r }))),
    create: ({ record }) =>
      _clash(record)
        ? Effect.fail(new ProviderApiError({ operation: "create", status: 400, body: `${record.type} beside a CNAME at ${record.name}` }))
        : Effect.sync(() => {
          calls.push(`create ${record.type}`)
          seed(record.name, record.type, record.value)
        }),
    update: ({ existing, record }) =>
      Effect.sync(() => {
        calls.push(`update ${record.type}`)
        rows = rows.map((r) => r.id === existing.id ? { ...r, value: record.value, ttl: record.ttl } : r)
      }),
    delete: ({ record }) =>
      Effect.sync(() => {
        calls.push(`delete ${record.type}`)
        rows = rows.filter((r) => r.id !== record.id)
      }),
    normalize: ({ name }) => name.toLowerCase(),
    canonical: ({ type, value }) => type === "CNAME" ? _unquote(value).toLowerCase().replace(/\.$/, "") : _unquote(value)
  }

  return { adapter, calls, seed, rows: () => rows }
}

const _target = (rows: ReadonlyArray<ZoneRecord>, name: string): string | undefined =>
  rows.find((r) => r.name === name && (r.type === "A" || r.type === "AAAA" || r.type === "CNAME"))?.value

describe("dnsProviderContract against an in-memory adapter", () => {
  dnsProviderContract(() => {
    const mem = _build()

    return {
      zone: _ZONE,
      provider: reconcileDns(mem.adapter),
      targetOf: (name) => _target(mem.rows(), name),
      seedForeign: (name, target) => mem.seed(name, "A", target),
      seedForeignKind: (name, type, target) => mem.seed(name, type, target),
      seedForeignOwnerTxt: (name, tag) => mem.seed(name, "TXT", `kumulo.cluster=${tag}`),
      seedForeignTxt: (name, value) => mem.seed(name, "TXT", value),
      kindsAt: (name) => mem.rows().filter((r) => r.name === name).map((r) => r.type).toSorted(),
      valuesAt: (name, type) => mem.rows().filter((r) => r.name === name && r.type === type).map((r) => r.value)
    }
  })
})

describe("reconcileDns", () => {
  const desired = [
    { name: "api.example.com", target: "kumulo.cluster=a" },
    { name: "api.example.com", target: "10.0.0.1" }
  ]

  it.effect("is idempotent: a second ensure makes no writes", () =>
    Effect.gen(function*() {
      const mem = _build()
      const provider = reconcileDns(mem.adapter)
      yield* provider.ensureRecords(_ZONE, desired)
      mem.calls.length = 0
      yield* provider.ensureRecords(_ZONE, desired)
      assert.deepStrictEqual(mem.calls, [])
    }))

  it.effect("treats quoted TXT and trailing-dot CNAME as equal to the desired value", () =>
    Effect.gen(function*() {
      const mem = _build()
      mem.seed("_kumulo.www.example.com", "TXT", "\"kumulo.cluster=a\"")
      mem.seed("www.example.com", "CNAME", "LB.Example.net.")
      yield* reconcileDns(mem.adapter).ensureRecords(_ZONE, [
        { name: "www.example.com", target: "kumulo.cluster=a" },
        { name: "www.example.com", target: "lb.example.net" }
      ])
      assert.deepStrictEqual(mem.calls, [])
    }))

  it.effect("converges duplicate owned records down to one", () =>
    Effect.gen(function*() {
      const mem = _build()
      mem.seed("_kumulo.api.example.com", "TXT", "kumulo.cluster=a")
      mem.seed("api.example.com", "A", "10.0.0.1")
      mem.seed("api.example.com", "A", "10.0.0.1")
      yield* reconcileDns(mem.adapter).ensureRecords(_ZONE, desired)
      assert.strictEqual(mem.rows().filter((r) => r.type === "A").length, 1)
    }))

  it.effect("rejects two targets for one name", () =>
    Effect.gen(function*() {
      const mem = _build()
      const records = [...desired, { name: "api.example.com", target: "10.0.0.2" }]

      const err = yield* Effect.flip(reconcileDns(mem.adapter).ensureRecords(_ZONE, records))

      assert.strictEqual(err._tag, "ResourceConflict")
    }))

  it.effect("skips contested names on remove", () =>
    Effect.gen(function*() {
      const mem = _build()
      mem.seed("api.example.com", "TXT", "kumulo.cluster=a")
      mem.seed("api.example.com", "TXT", "kumulo.cluster=b")
      mem.seed("api.example.com", "A", "10.0.0.1")
      yield* reconcileDns(mem.adapter).removeClusterRecords(_ZONE, "a")
      assert.strictEqual(mem.rows().length, 3)
    }))

  it.effect("skips a name contested across the old and the new TXT location", () =>
    Effect.gen(function*() {
      const mem = _build()
      mem.seed("api.example.com", "TXT", "kumulo.cluster=a")
      mem.seed("_kumulo.api.example.com", "TXT", "kumulo.cluster=b")
      mem.seed("api.example.com", "A", "10.0.0.1")
      yield* reconcileDns(mem.adapter).removeClusterRecords(_ZONE, "a")
      assert.strictEqual(mem.rows().length, 3)
    }))

  it.effect("moves a 0.2-style TXT before it writes a CNAME at that name", () =>
    Effect.gen(function*() {
      const mem = _build()
      mem.seed("www.example.com", "TXT", "kumulo.cluster=a")
      mem.seed("www.example.com", "A", "10.0.0.1")
      yield* reconcileDns(mem.adapter).ensureRecords(_ZONE, [
        { name: "www.example.com", target: "kumulo.cluster=a" },
        { name: "www.example.com", target: "lb.example.net" }
      ])
      assert.deepStrictEqual(mem.calls, ["create TXT", "delete TXT", "delete A", "create CNAME"])
      assert.deepStrictEqual(mem.rows().map((r) => `${r.name} ${r.type}`).toSorted(), ["_kumulo.www.example.com TXT", "www.example.com CNAME"])
    }))

  it.effect("removes an ownership TXT whose record was deleted by hand", () =>
    Effect.gen(function*() {
      const mem = _build()
      mem.seed("_kumulo._wildcard.c1.example.com", "TXT", "kumulo.cluster=a")
      mem.seed("_kumulo.example.com", "TXT", "kumulo.cluster=a")
      yield* reconcileDns(mem.adapter).removeClusterRecords(_ZONE, "a")
      assert.deepStrictEqual(mem.rows(), [])
    }))
})

describe("reconcileDns with relative names and @ for the apex", () => {
  const _relative = () => {
    const mem = _build()

    const adapter: DnsAdapter = {
      ...mem.adapter,
      normalize: ({ name, zone }) => {
        const lowered = name.toLowerCase()

        if (lowered === "" || lowered === "@" || lowered === zone) return "@"

        return lowered.endsWith(`.${zone}`) ? lowered.slice(0, -(zone.length + 1)) : lowered
      }
    }

    return { ...mem, adapter }
  }

  it.effect("writes the apex ownership TXT at _kumulo and the wildcard one at _kumulo._wildcard", () =>
    Effect.gen(function*() {
      const mem = _relative()
      const provider = reconcileDns(mem.adapter)
      yield* provider.ensureRecords(_ZONE, [
        { name: "@", target: "kumulo.cluster=a" },
        { name: "@", target: "lb.example.net" },
        { name: "*", target: "kumulo.cluster=a" },
        { name: "*", target: "lb.example.net" }
      ])
      assert.deepStrictEqual(mem.rows().map((r) => `${r.name} ${r.type}`).toSorted(), ["* CNAME", "@ CNAME", "_kumulo TXT", "_kumulo._wildcard TXT"])
      mem.calls.length = 0
      yield* provider.ensureRecords(_ZONE, [
        { name: "example.com", target: "kumulo.cluster=a" },
        { name: "example.com", target: "lb.example.net" }
      ])
      assert.deepStrictEqual(mem.calls, [])
      yield* provider.removeClusterRecords(_ZONE, "a")
      assert.deepStrictEqual(mem.rows(), [])
    }))
})
