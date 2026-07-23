import { describe, expect, it } from "@effect/vitest"
import { FastCheck as fc } from "effect/testing"
import { configHash } from "../../src/plan/hash.ts"

describe("configHash", () => {
  it("is stable regardless of object key order", () => {
    const a = configHash({ flavor: "b2-7", image: "ubuntu-24.04", count: 3 })
    const b = configHash({ count: 3, image: "ubuntu-24.04", flavor: "b2-7" })
    expect(a).toBe(b)
  })

  it.prop("is deterministic for any spec", [fc.jsonValue()], ([spec]) => configHash(spec) === configHash(spec))

  it.prop(
    "differs when a value changes",
    [fc.string(), fc.string()],
    ([a, b]) => a === b || configHash({ flavor: a }) !== configHash({ flavor: b })
  )
})
