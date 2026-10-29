#!/usr/bin/env bun
import { writeFileSync } from "node:fs"
import { JsonSchema, Schema } from "effect"
import { authMethodsByProvider } from "@kumulo/core"
import { ClusterConfig } from "../packages/cli/src/cluster-config.ts"

// Mirrors the cross-field `.check(...)` filters in core's schema.ts — keep in sync.
// kumulo: godaddy apex-CNAME rule is not expressible in JSON Schema (compares record.name to dns.zone).
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
        addons: { properties: { csi: { not: { required: ["default_volume_type"] } } } }
      }
    },
    else: {
      properties: {
        volumes: { properties: { module: { not: { const: "hcloud" } } } }
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
    if: {
      properties: { cdn: { properties: { origin: { const: "ingress" } }, required: ["origin"] } },
      required: ["cdn"]
    },
    then: { properties: { distro: { const: "ovh-mks" } }, required: ["ingress"] }
  },
  {
    if: {
      properties: { dns: { properties: { module: { const: "godaddy" } }, required: ["module"] } },
      required: ["dns"]
    },
    then: { properties: { dns: { properties: { ttl: { minimum: 600 } } } } }
  },
  {
    if: { required: ["ingress"] },
    then: { required: ["network"] }
  }
]

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
  allOf: crossFieldConstraints,
  $defs: document.definitions
}

writeFileSync(new URL("../kumulo.schema.json", import.meta.url), `${JSON.stringify(schema, null, 2)}\n`)

console.log("wrote kumulo.schema.json")
