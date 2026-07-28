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

// Mirrors the cross-field `.check(...)` filters in core's schema.ts (the
// Effect->JSON-Schema conversion cannot express them) — keep in sync. The
// distro rules are derived from the union's variants, as are the per-module
// field rules (dns zone/ttl/records, secrets sops block, object_storage
// buckets, mks volumes), so those live here no longer. What is left spans two
// independent unions: provider->auth/volumes/addons and object_storage->secrets.
const crossFieldConstraints = [
  {
    if: { properties: { provider: { const: "hetzner" } }, required: ["provider"] },
    then: {
      properties: {
        auth: { properties: { method: { const: "api_token" } } },
        volumes: { properties: { module: { enum: ["hcloud", "none"] } } },
        addons: { properties: { cinder_csi: { properties: { enabled: { const: false } } } } }
      }
    },
    else: {
      properties: {
        auth: { properties: { method: { not: { const: "api_token" } } } },
        volumes: { properties: { module: { not: { const: "hcloud" } } } },
        addons: { properties: { hcloud_csi: { properties: { enabled: { const: false } } } } }
      }
    }
  },
  {
    if: {
      properties: { object_storage: { properties: { module: { const: "ovh" } }, required: ["module"] } },
      required: ["object_storage"]
    },
    then: { properties: { secrets: { properties: { sink: { not: { const: "none" } } } } } }
  },
  // `isIngressPlaceable`: an ingress LB's VIP has to sit on the network's
  // load_balancers_subnet, so `ingress` is meaningless without `network`.
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
