import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { isGodaddyApexNotCname } from "../src/config/schema.ts"

const _Config = Schema.Struct({
  dns: Schema.Struct({
    module: Schema.String,
    zone: Schema.String,
    records: Schema.Array(Schema.Struct({ name: Schema.String, target: Schema.String }))
  })
}).check(isGodaddyApexNotCname)

const _ok = (target: string) =>
  Schema.is(_Config)({ dns: { module: "godaddy", zone: "example.com", records: [{ name: "@", target }] } })

describe("isGodaddyApexNotCname ip literal", () => {
  it("accepts valid IPv4 and IPv6", () => {
    expect(_ok("203.0.113.7")).toBe(true)
    expect(_ok("2001:db8::1")).toBe(true)
  })

  it("rejects malformed IPv6 and zero-padded IPv4", () => {
    expect(_ok(":")).toBe(false)
    expect(_ok("abc:")).toBe(false)
    expect(_ok("010.001.001.001")).toBe(false)
  })
})
