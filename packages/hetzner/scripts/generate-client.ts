#!/usr/bin/env bun
// CI does not run this script — codegen:check regenerates in-memory and diffs against the committed output instead.
import { Effect } from "effect"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi"
import { runPipeline } from "codegen"
import type { NamedPatch } from "codegen"

const root = join(import.meta.dirname, "..")

const specPath = "specs/hcloud/cloud.spec.json"
const allowlistPath = "allowlists/hcloud.json"
const patchPath = "patches/hcloud.patch.json5"
const outputPath = "src/generated/hcloud.ts"

const _parseJson5 = (text: string): NamedPatch["patch"] => JSON.parse(text.replace(/\/\/.*$/gm, ""))

const program = Effect.gen(function*() {
  const spec: OpenAPISpec = JSON.parse(readFileSync(join(root, specPath), "utf8"))
  const allowlistDoc = JSON.parse(readFileSync(join(root, allowlistPath), "utf8"))
  const patches: ReadonlyArray<NamedPatch> = [{
    source: patchPath,
    patch: _parseJson5(readFileSync(join(root, patchPath), "utf8"))
  }]

  const { source, warnings } = yield* runPipeline({
    spec,
    allowlist: allowlistDoc.operationIds,
    patches,
    generate: { name: "Hcloud", format: "httpapi" }
  })

  writeFileSync(join(root, outputPath), source)
  console.log(`hcloud: wrote ${outputPath} (${warnings.length} warnings)`)
})

Effect.runPromise(program).catch((error) => {
  console.error("generate-client failed:", error)
  process.exit(1)
})
