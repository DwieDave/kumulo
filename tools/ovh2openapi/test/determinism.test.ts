import { it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "effect/testing/FastCheck"
import { convert } from "../src/convert.ts"
import type { OvhModel, OvhSchema } from "../src/domain.ts"

const _propName = fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,8}$/)
const _primitiveType = fc.constantFrom("string", "boolean", "long", "integer", "float", "double")

const _objectModel: fc.Arbitrary<OvhModel> = fc
  .dictionary(_propName, fc.record({ fullType: _primitiveType, required: fc.boolean() }), { maxKeys: 5 })
  .map((properties): OvhModel => ({ id: "M", namespace: "x", properties }))

const _schemaArb: fc.Arbitrary<OvhSchema> = fc
  .dictionary(_propName.map((n: string) => `x.${n}`), _objectModel, { maxKeys: 5 })
  .map((models): OvhSchema => ({ apis: [], models }))

it.prop("converting the same OVH schema twice yields byte-identical JSON", [_schemaArb], ([schema]) => {
  const once = JSON.stringify(Effect.runSync(convert(schema)))
  const twice = JSON.stringify(Effect.runSync(convert(schema)))
  return once === twice
})
