#!/usr/bin/env bun
/**
 * Rewrites every JSON Schema node using OpenAPI 3.1's `"type": [X, "null"]`
 * nullable idiom into the equivalent explicit `oneOf: [{ type: X, ... }, { type:
 * "null" }]` form.
 *
 * Workaround for a `@effect/openapi-generator@4.0.0-beta.101` (effect's
 * `SchemaRepresentation` JSON-Schema-to-code converter) limitation: a
 * two-element `type` array silently collapses to `Schema.Never` instead of
 * the `Schema.Union([X, Schema.Null])` the equivalent `oneOf` form produces
 * correctly (verified against both forms directly). Hetzner's spec uses the
 * array idiom for every nullable field — every list response's pagination
 * block included — so left untransformed this would make every allowlisted
 * list/get response fail to decode against real API data.
 */

const _isNullableTypeArray = (type: unknown): type is ReadonlyArray<string> =>
  Array.isArray(type) && type.length === 2 && type.includes("null")

const _denullify = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(_denullify)
  if (node === null || typeof node !== "object") return node
  const children = Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, _denullify(value)])
  )
  if (!_isNullableTypeArray(children.type)) return children
  const otherType = children.type.find((candidate) => candidate !== "null")
  const { type: _type, ...rest } = children
  return { oneOf: [{ ...rest, type: otherType }, { type: "null" }] }
}

/** Exported for the `scripts/generate-client.ts` self-check and any future test. */
export const denullifySpec = (spec: unknown): unknown => _denullify(spec)

if (import.meta.main) {
  const [inputPath, outputPath] = process.argv.slice(2)
  if (inputPath === undefined || outputPath === undefined) {
    console.error("usage: bun run scripts/denullify-spec.ts <input.json> <output.json>")
    process.exit(1)
  }
  const source = JSON.parse(await Bun.file(inputPath).text())
  await Bun.write(outputPath, `${JSON.stringify(denullifySpec(source), null, 2)}\n`)
}
