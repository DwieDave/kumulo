#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs"
import { JsonSchema, Schema } from "effect"
import { ClusterConfig, clusterConfigRules } from "../packages/cli/src/cluster-config.ts"

const document = Schema.toJsonSchemaDocument(ClusterConfig)

// `additionalProperties: false` would otherwise reject the very `$schema` key
// json configs use to reference this document — allow it in every variant.
type Variant = { properties: Schema.JsonObject }

const anyOf = document.schema["anyOf"]
const variants: ReadonlyArray<Variant> = Array.isArray(anyOf) ? anyOf : []

const schema = {
  $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
  title: "kumulo cluster config",
  anyOf: variants.map((v) => ({ ...v, properties: { $schema: { type: "string" }, ...v.properties } })),
  // rules JSON Schema cannot express (e.g. the godaddy apex CNAME check) render as nothing
  allOf: [...new Set(clusterConfigRules)].flatMap((rule) => rule.jsonSchema),
  $defs: document.definitions
}

const target = new URL("../kumulo.schema.json", import.meta.url)
const rendered = `${JSON.stringify(schema, null, 2)}\n`

if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") === rendered) console.log("kumulo.schema.json is up to date")
  else {
    console.error("kumulo.schema.json is stale: run `bun run schema:generate` and commit")
    process.exit(1)
  }
} else {
  writeFileSync(target, rendered)
  console.log("wrote kumulo.schema.json")
}
