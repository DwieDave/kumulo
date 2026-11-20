import { describe, expect, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { ClusterName } from "../src/config/schema.ts"

const _accepts = (value: string): boolean => Option.isSome(Schema.decodeUnknownOption(ClusterName)(value))

describe("ClusterName", () => {
  it("accepts DNS labels", () => {
    expect(_accepts("prod-eu")).toBe(true)
    expect(_accepts("a")).toBe(true)
    expect(_accepts("a".repeat(63))).toBe(true)
  })

  it("rejects path escapes and non-labels", () => {
    expect(_accepts("../x")).toBe(false)
    expect(_accepts("a/b")).toBe(false)
    expect(_accepts("-a")).toBe(false)
    expect(_accepts("a-")).toBe(false)
    expect(_accepts("Prod")).toBe(false)
    expect(_accepts("")).toBe(false)
    expect(_accepts("a".repeat(64))).toBe(false)
  })
})
