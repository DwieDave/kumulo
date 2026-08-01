#!/usr/bin/env bun
// Workaround: @effect/openapi-generator's two-element `type: [X, "null"]` array silently collapses to Schema.Never; rewritten here to the
// equivalent `oneOf` form.
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
