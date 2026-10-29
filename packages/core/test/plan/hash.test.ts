import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import { configHash } from "../../src/plan/hash.ts"

describe("configHash", () => {
  it("is stable regardless of object key order", () => {
    const a = configHash({ flavor: "b2-7", image: "ubuntu-24.04", count: 3 })
    const b = configHash({ count: 3, image: "ubuntu-24.04", flavor: "b2-7" })
    expect(a).toBe(b)
  })

  it("matches the hashes already stamped on deployed resources", () => {
    expect(configHash({ flavor: "b2-7", image: "ubuntu-24.04", count: 3 })).toBe("6c54ee47ba5e139e")
    expect(
      configHash({
        pools: [{ name: "workers", size: 2 }, { name: "batch", tags: ["a", "b"] }],
        region: "GRA",
        nested: { z: null, a: true }
      })
    ).toBe("bafc0f3152fcc3ff")
  })

  it.prop("is deterministic for any spec", [Schema.Json], ([spec]) => configHash(spec) === configHash(spec))

  it.prop(
    "differs when a value changes",
    [Schema.String, Schema.String],
    ([a, b]) => a === b || configHash({ flavor: a }) !== configHash({ flavor: b })
  )
})
