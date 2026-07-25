#!/usr/bin/env bun
/**
 * Generates kumulo.schema.json (JSON Schema draft 2020-12) from the
 * ClusterConfig Effect schema, for IDE type hinting:
 *   - json configs: `"$schema": "./kumulo.schema.json"`
 *   - yaml configs: `# yaml-language-server: $schema=./kumulo.schema.json`
 * Run via `bun scripts/generate-schema.ts`; commit the result.
 */
import { writeFileSync } from "node:fs"
import { JsonSchema, Schema } from "effect"
import { ClusterConfig } from "@kumulo/core"

const document = Schema.toJsonSchemaDocument(ClusterConfig)
// `additionalProperties: false` would otherwise reject the very `$schema` key
// json configs use to reference this document — allow it explicitly.
const schema = {
  $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
  title: "kumulo cluster config",
  ...document.schema,
  properties: { $schema: { type: "string" }, ...(document.schema as { properties: object }).properties },
  $defs: document.definitions
}
writeFileSync(new URL("../kumulo.schema.json", import.meta.url), `${JSON.stringify(schema, null, 2)}\n`)
console.log("wrote kumulo.schema.json")
