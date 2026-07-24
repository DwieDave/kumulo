#!/usr/bin/env bun
/**
 * Regenerates the six OpenStack generated clients (`src/generated/<service>.ts`)
 * from the vendored specs, via a filter -> patch -> generate pipeline.
 *
 * Run via `bun run generate` in this package, or the root `specs:update:openstack`
 * flow (re-fetch specs, then re-run this to pick up upstream changes). CI does
 * NOT run this script — `codegen:check` (tools/codegen) regenerates in-memory
 * and diffs against the committed output instead.
 */
import { Effect } from "effect"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as YAML from "yaml"
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi"
import { runPipeline } from "codegen"
import type { NamedPatch } from "codegen"

const root = join(import.meta.dirname, "..")

interface ServiceConfig {
  readonly name: string
  readonly service: string
  readonly specPath: string
  readonly allowlistPath: string
  readonly patchPath: string
  readonly outputPath: string
}

const services: ReadonlyArray<ServiceConfig> = [
  { name: "Keystone", service: "keystone", specPath: "specs/keystone/v3.14.yaml", allowlistPath: "allowlists/keystone.json", patchPath: "patches/keystone.patch.json5", outputPath: "src/generated/keystone.ts" },
  { name: "Nova", service: "nova", specPath: "specs/nova/v2.96.yaml", allowlistPath: "allowlists/nova.json", patchPath: "patches/nova.patch.json5", outputPath: "src/generated/nova.ts" },
  { name: "Neutron", service: "neutron", specPath: "specs/neutron/v2.yaml", allowlistPath: "allowlists/neutron.json", patchPath: "patches/neutron.patch.json5", outputPath: "src/generated/neutron.ts" },
  { name: "Glance", service: "glance", specPath: "specs/glance/v2.16.yaml", allowlistPath: "allowlists/glance.json", patchPath: "patches/glance.patch.json5", outputPath: "src/generated/glance.ts" },
  { name: "Cinder", service: "cinder", specPath: "specs/cinder/v3.70.yaml", allowlistPath: "allowlists/cinder.json", patchPath: "patches/cinder.patch.json5", outputPath: "src/generated/cinder.ts" },
  { name: "Octavia", service: "octavia", specPath: "specs/octavia/v2.yaml", allowlistPath: "allowlists/octavia.json", patchPath: "patches/octavia.patch.json5", outputPath: "src/generated/octavia.ts" }
]

// kumulo: patches are JSON5 (allow `// why` comments); stripping `//` line comments
// before JSON.parse is sufficient since no patch value contains a literal `//`.
// kumulo: return type is the patch document shape directly (not `unknown`) — JSON.parse's
// result is a genuine `any`, so this needs no type assertion to satisfy that signature.
const _parseJson5 = (text: string): NamedPatch["patch"] => JSON.parse(text.replace(/\/\/.*$/gm, ""))

const _generateOne = (config: ServiceConfig) =>
  Effect.gen(function*() {
    const spec: OpenAPISpec = YAML.parse(readFileSync(join(root, config.specPath), "utf8"))
    const allowlistDoc = JSON.parse(readFileSync(join(root, config.allowlistPath), "utf8"))
    const patches: ReadonlyArray<NamedPatch> = [{
      source: config.patchPath,
      patch: _parseJson5(readFileSync(join(root, config.patchPath), "utf8"))
    }]

    const { source, warnings } = yield* runPipeline({
      spec,
      allowlist: allowlistDoc.operationIds,
      patches,
      generate: { name: config.name, format: "httpapi" }
    })

    writeFileSync(join(root, config.outputPath), source)
    console.log(`${config.service}: wrote ${config.outputPath} (${warnings.length} warnings)`)
  })

Effect.runPromise(Effect.forEach(services, _generateOne, { discard: true })).catch((error) => {
  console.error("generate-clients failed:", error)
  process.exit(1)
})
