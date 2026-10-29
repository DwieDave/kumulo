import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { makeFakeZone } from "../provider/fake-zone.ts"

const _record = { name: "www", type: "A", data: "192.0.2.1", ttl: 600 } as const

describe("godaddy dns client", () => {
  it.effect("creates, lists, replaces and deletes a record", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com" })
      const created = yield* fake.dns.createRecord({ zone: "example.com", record: _record })

      expect(created.recordId).toMatch(/^rec_/)

      const listed = yield* fake.dns.listRecords({ zone: "example.com" })
      expect(listed.map((r) => r.recordId)).toEqual([created.recordId])

      const replaced = yield* fake.dns.replaceRecord({
        zone: "example.com",
        recordId: created.recordId,
        record: { ..._record, data: "192.0.2.9", ttl: 900 }
      })

      expect(replaced.data).toBe("192.0.2.9")
      expect(fake.peek({ name: "www", type: "A" })?.ttl).toBe(900)

      yield* fake.dns.deleteRecord({ zone: "example.com", recordId: created.recordId })
      expect(fake.peekAll()).toEqual([])
    }))

  it.effect("falls back to the Location header for the created id", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com", locationOnlyIds: true })
      const created = yield* fake.dns.createRecord({ zone: "example.com", record: _record })
      expect(Option.fromNullishOr(fake.peekAll()[0]?.recordId)).toEqual(Option.some(created.recordId))
    }))

  it.effect("follows next links across pages", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com", pageSize: 2 })
      yield* Effect.forEach(["a", "b", "c", "d", "e"], (name) => fake.dns.createRecord({ zone: "example.com", record: { ..._record, name } }))
      const listed = yield* fake.dns.listRecords({ zone: "example.com" })
      expect(listed.map((r) => r.name)).toEqual(["a", "b", "c", "d", "e"])
      const gets = fake.requests().filter((r) => r.method === "GET")
      expect(gets).toHaveLength(3)
      expect(gets[0]?.search).toContain("pageSize=100")
    }))

  it.effect("treats a 404 delete as success", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com" })
      yield* fake.dns.deleteRecord({ zone: "example.com", recordId: "missing" })
      expect(fake.requests().map((r) => r.method)).toEqual(["DELETE"])
    }))

  it.effect("fails when the fake rejects a ttl below 600", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com" })
      const exit = yield* Effect.exit(fake.dns.createRecord({ zone: "example.com", record: { ..._record, ttl: 300 } }))
      expect(exit._tag).toBe("Failure")
      expect(fake.peekAll()).toEqual([])
    }))

  it.effect("follows absolute next hrefs that carry the /v3/domains prefix", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com", pageSize: 2, hrefPrefix: "/v3/domains" })
      yield* Effect.forEach(["a", "b", "c", "d", "e"], (name) => fake.dns.createRecord({ zone: "example.com", record: { ..._record, name } }))
      const listed = yield* fake.dns.listRecords({ zone: "example.com" })
      expect(listed.map((r) => r.name)).toEqual(["a", "b", "c", "d", "e"])
      expect(fake.requests().filter((r) => r.method === "GET").every((r) => r.path === "/zones/example.com/dns-records")).toBe(true)
    }))

  it.effect("fails with ResponseDecodeError when the next link repeats", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com", repeatNext: true })
      const error = yield* Effect.flip(fake.dns.listRecords({ zone: "example.com" }))
      expect(error._tag).toBe("ResponseDecodeError")
      expect(fake.requests().length).toBeLessThan(5)
    }))

  it.effect("accepts a 201 with an empty body and a Location header", () =>
    Effect.gen(function*() {
      const fake = makeFakeZone({ zone: "example.com", emptyCreateBody: true })
      const created = yield* fake.dns.createRecord({ zone: "example.com", record: _record })
      expect(Option.fromNullishOr(fake.peekAll()[0]?.recordId)).toEqual(Option.some(created.recordId))
    }))
})
