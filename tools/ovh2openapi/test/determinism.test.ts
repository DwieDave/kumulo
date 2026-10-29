import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { convert } from "../src/convert.ts"
import type { OvhModel, OvhSchema } from "../src/domain.ts"

const _propName = Schema.String.check(Schema.isPattern(/^[a-z][a-zA-Z0-9]{0,8}$/))
const _primitiveType = Schema.Literals(["string", "boolean", "long", "integer", "float", "double"])
const _property = Schema.Struct({ fullType: _primitiveType, required: Schema.Boolean })
const _schemaFields = Schema.Record(_propName, Schema.Record(_propName, _property))

const _toSchema = (fields: typeof _schemaFields.Type): OvhSchema => ({
  apis: [],
  models: Object.fromEntries(
    Object.entries(fields).map(([name, properties]): [string, OvhModel] => [
      `x.${name}`,
      { id: "M", namespace: "x", properties }
    ])
  )
})

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
  [_schemaFields],
  ([fields]) => {
    const schema = _toSchema(fields)
    const original = JSON.stringify(Effect.runSync(convert(schema)))
    const reordered = JSON.stringify(Effect.runSync(convert(_reorderKeys(schema))))

    return original === reordered
  }
)
