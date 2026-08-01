#!/usr/bin/env bun
import { writeFileSync } from "node:fs"
import { JsonSchema, Schema } from "effect"
import { authMethodsByProvider } from "@kumulo/core"
import { ClusterConfig } from "../packages/cli/src/cluster-config.ts"

// Mirrors the cross-field `.check(...)` filters in core's schema.ts — keep in sync.
const crossFieldConstraints = [
  ...Object.entries(authMethodsByProvider).map(([provider, methods]) => ({
    if: { properties: { provider: { const: provider } }, required: ["provider"] },
    then: { properties: { auth: { properties: { method: { enum: [...methods] } } } } }
  })),
  {
    if: { properties: { provider: { const: "hetzner" } }, required: ["provider"] },
    then: {
      properties: {
        volumes: { properties: { module: { enum: ["hcloud", "none"] } } },
        addons: { properties: { cinder_csi: { properties: { enabled: { const: false } } } } }
      }
    },
    else: {
      properties: {
        volumes: { properties: { module: { not: { const: "hcloud" } } } },
        addons: { properties: { hcloud_csi: { properties: { enabled: { const: false } } } } }
      }
    }
  },
  {
    if: {
      properties: { object_storage: { properties: { module: { not: { const: "none" } } }, required: ["module"] } },
      required: ["object_storage"]
    },
    then: { properties: { secrets: { properties: { sink: { not: { const: "none" } } } } } }
  },
  {
    if: { required: ["ingress"] },
    then: { required: ["network"] }
  }
]

const document = Schema.toJsonSchemaDocument(ClusterConfig)
// `additionalProperties: false` would otherwise reject the very `$schema` key
// json configs use to reference this document — allow it in every variant.
type Variant = { properties: Record<string, unknown> }
const anyOf = document.schema["anyOf"]
const variants: ReadonlyArray<Variant> = Array.isArray(anyOf) ? anyOf : []
const schema = {
  $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
  title: "kumulo cluster config",
  anyOf: variants.map((v) => ({ ...v, properties: { $schema: { type: "string" }, ...v.properties } })),
  allOf: crossFieldConstraints,
  $defs: document.definitions
}
writeFileSync(new URL("../kumulo.schema.json", import.meta.url), `${JSON.stringify(schema, null, 2)}\n`)
console.log("wrote kumulo.schema.json")
