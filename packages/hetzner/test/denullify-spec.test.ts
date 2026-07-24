import { assert, it } from "@effect/vitest"
import { denullifySpec } from "../scripts/denullify-spec.ts"

it("rewrites a nullable-type-array leaf into an equivalent oneOf", () => {
  const out = denullifySpec({ type: "object", properties: { n: { type: ["integer", "null"], format: "int64" } } })
  assert.deepStrictEqual(out, {
    type: "object",
    properties: { n: { oneOf: [{ type: "integer", format: "int64" }, { type: "null" }] } }
  })
})

it("leaves non-nullable nodes untouched", () => {
  const out = denullifySpec({ type: "string", format: "date-time" })
  assert.deepStrictEqual(out, { type: "string", format: "date-time" })
})
