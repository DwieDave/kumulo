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

// kumulo: rebuilds every dict (models, and each model's properties) with its
// keys inserted in reverse order — same entries, different iteration order.
// A `JSON.stringify`/`Object.keys` dependent bug in `convert` would only show
// up against a *reordered* rebuild, never against converting one fixed
// object twice (that's deterministic by construction, not by the code
// under test).
const _reorderKeys = (schema: OvhSchema): OvhSchema => ({
  ...schema,
  models: Object.fromEntries(
    Object.entries(schema.models).toReversed().map(([key, model]): [string, OvhModel] => [
      key,
      "enum" in model ? model : { ...model, properties: Object.fromEntries(Object.entries(model.properties).toReversed()) }
    ])
  )
})

it.prop(
  "converting structurally-equal schemas with different key insertion order yields byte-identical JSON",
  [_schemaArb],
  ([schema]) => {
    const original = JSON.stringify(Effect.runSync(convert(schema)))
    const reordered = JSON.stringify(Effect.runSync(convert(_reorderKeys(schema))))
    return original === reordered
  }
)
