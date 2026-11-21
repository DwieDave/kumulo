import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { cloudflareTtlRange } from "../src/config.ts"

const _Config = Schema.Struct({
  dns: Schema.Struct({ module: Schema.String, zone: Schema.String, ttl: Schema.Number })
}).check(cloudflareTtlRange.filter)

const _ok = (ttl: number, module = "cloudflare") => Schema.is(_Config)({ dns: { module, zone: "example.com", ttl } })

describe("cloudflare config rules", () => {
  it("accepts 1 (automatic) and 60 to 86400", () => {
    for (const ttl of [1, 60, 300, 600, 86400]) expect(_ok(ttl)).toBe(true)
  })

  it("rejects 2 to 59 and anything above 86400", () => {
    for (const ttl of [2, 30, 59, 86401]) expect(_ok(ttl)).toBe(false)
  })

  it("leaves other modules alone", () => {
    expect(_ok(30, "hetzner")).toBe(true)
  })
})
