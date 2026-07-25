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
import { ClusterConfig, K3S_ONLY_BLOCKS } from "@kumulo/core"

// Mirrors the cross-field `.check(...)` filters in core's schema.ts (the
// Effect->JSON-Schema conversion cannot express them) — keep in sync.
const crossFieldConstraints = [
  {
    if: { properties: { distro: { const: "k3s" } }, required: ["distro"] },
    then: {
      required: [...K3S_ONLY_BLOCKS],
      properties: { version: { pattern: "^v\\d+\\.\\d+\\.\\d+\\+k3s\\d+$" } }
    },
    else: {
      properties: {
        version: { pattern: "^v?\\d+\\.\\d+\\.\\d+$" },
        dns: { properties: { module: { not: { enum: ["ovh", "designate"] } } } }
      }
    }
  },
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
  }
]

const document = Schema.toJsonSchemaDocument(ClusterConfig)
// `additionalProperties: false` would otherwise reject the very `$schema` key
// json configs use to reference this document — allow it explicitly.
const schema = {
  $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
  title: "kumulo cluster config",
  ...document.schema,
  properties: { $schema: { type: "string" }, ...(document.schema as { properties: object }).properties },
  allOf: crossFieldConstraints,
  $defs: document.definitions
}
writeFileSync(new URL("../kumulo.schema.json", import.meta.url), `${JSON.stringify(schema, null, 2)}\n`)
console.log("wrote kumulo.schema.json")
