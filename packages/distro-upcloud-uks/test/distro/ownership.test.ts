import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { isValidLabel, ownershipLabels } from "../../src/distro/ownership.ts"

describe("isValidLabel", () => {
  it("accepts a key of 2-32 printable ASCII not starting with _", () => {
    expect(isValidLabel({ key: "kumulo-config-hash", value: "abc" })).toBe(true)
  })

  it("rejects a key starting with _", () => {
    expect(isValidLabel({ key: "_bad", value: "abc" })).toBe(false)
  })

  it("rejects a key shorter than 2 or longer than 32", () => {
    expect(isValidLabel({ key: "a", value: "" })).toBe(false)
    expect(isValidLabel({ key: "a".repeat(33), value: "" })).toBe(false)
  })

  it("rejects a value outside [A-Za-z0-9-_] or longer than 63", () => {
    expect(isValidLabel({ key: "owner", value: "not valid!" })).toBe(false)
    expect(isValidLabel({ key: "owner", value: "a".repeat(64) })).toBe(false)
    expect(isValidLabel({ key: "owner", value: "a".repeat(63) })).toBe(true)
    expect(isValidLabel({ key: "owner", value: "" })).toBe(true)
  })
})

describe("ownershipLabels", () => {
  it("stamps kumulo-config-hash and owner, both valid UpCloud labels", () => {
    const labels = ownershipLabels({ spec: { any: "thing" }, owner: "kumulo" })
    expect(labels.every(isValidLabel)).toBe(true)
    expect(labels.find((l) => l.key === "kumulo-config-hash")).toBeDefined()
    expect(labels.find((l) => l.key === "kumulo-owner")?.value).toBe("kumulo")
  })

  // D14: core's configHash is 16 lowercase hex chars — well inside the
  // 63-char value budget, no encoding layer needed.
  it.prop("core's configHash always satisfies UpCloud's value charset (D14)", [fc.jsonValue()], ([spec]) => {
    const labels = ownershipLabels({ spec, owner: "kumulo" })
    return labels.every(isValidLabel)
  })
})
