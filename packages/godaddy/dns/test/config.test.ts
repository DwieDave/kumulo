import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { godaddyApexNotCname, godaddyTtlMinimum } from "../src/config.ts"

const _Config = Schema.Struct({
  dns: Schema.Struct({
    module: Schema.String,
    zone: Schema.String,
    ttl: Schema.Number,
    records: Schema.Array(Schema.Struct({ name: Schema.String, target: Schema.String }))
  })
}).check(godaddyApexNotCname.filter, godaddyTtlMinimum.filter)

const _ok = (target: string) =>
  Schema.is(_Config)({ dns: { module: "godaddy", zone: "example.com", ttl: 600, records: [{ name: "@", target }] } })

describe("godaddy config rules", () => {
  it("accepts valid IPv4 and IPv6 at the apex", () => {
    expect(_ok("203.0.113.7")).toBe(true)
    expect(_ok("2001:db8::1")).toBe(true)
  })

  it("rejects malformed IPv6 and zero-padded IPv4", () => {
    expect(_ok(":")).toBe(false)
    expect(_ok("abc:")).toBe(false)
    expect(_ok("010.001.001.001")).toBe(false)
  })

  it("rejects a ttl below 600", () => {
    const config = { dns: { module: "godaddy", zone: "example.com", ttl: 300, records: [] } }

    expect(Schema.is(_Config)(config)).toBe(false)
  })
})
