#!/usr/bin/env bun
// Workaround: @effect/openapi-generator's two-element `type: [X, "null"]` array silently collapses to Schema.Never; rewritten here to the
// equivalent `oneOf` form.
import { Predicate } from "effect"
import type { Schema } from "effect"

const _isNullableTypeArray = (type: Schema.Json | undefined): type is ReadonlyArray<string> =>
  Array.isArray(type) && type.length === 2 && type.includes("null")

const _isJsonObject = (value: Schema.Json): value is { readonly [key: string]: Schema.Json } =>
  Predicate.isObject(value) && !Array.isArray(value)

const _denullify = (node: Schema.Json): Schema.Json => {
  if (Array.isArray(node)) return node.map(_denullify)

  if (!_isJsonObject(node)) return node

  const children: Record<string, Schema.Json> = Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, _denullify(value)])
  )

  const nullable = children.type

  if (!_isNullableTypeArray(nullable)) return children
  const otherType = nullable.find((candidate) => candidate !== "null")
  const { type: _type, ...rest } = children

  return { oneOf: [{ ...rest, type: otherType ?? null }, { type: "null" }] }
}

export const denullifySpec = (spec: Schema.Json): Schema.Json => _denullify(spec)

if (import.meta.main) {
  const [inputPath, outputPath] = process.argv.slice(2)

  if (inputPath === undefined || outputPath === undefined) {
    console.error("usage: bun run scripts/denullify-spec.ts <input.json> <output.json>")
    process.exit(1)
  }

  const source: Schema.Json = JSON.parse(await Bun.file(inputPath).text())
  await Bun.write(outputPath, `${JSON.stringify(denullifySpec(source), null, 2)}\n`)
}
