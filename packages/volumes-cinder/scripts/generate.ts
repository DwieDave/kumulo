#!/usr/bin/env bun
import { Effect } from "effect"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as YAML from "yaml"
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi"
import { runPipeline, type NamedPatch } from "codegen"

const root = join(import.meta.dirname, "..")

const _allowlistPath = "allowlists/cinder.json"
const _patchPath = "patches/cinder.patch.json5"
const _outputPath = "src/generated/cinder.ts"

// kumulo: patches are JSON5; stripping // line comments before JSON.parse is enough here
const _parseJson5 = (text: string): NamedPatch["patch"] => JSON.parse(text.replace(/\/\/.*$/gm, ""))

export const generate = () =>
  Effect.gen(function*() {
    const allowlist = JSON.parse(readFileSync(join(root, _allowlistPath), "utf8"))
    const spec: OpenAPISpec = YAML.parse(readFileSync(join(root, allowlist.spec), "utf8"))
    const patches: ReadonlyArray<NamedPatch> = [{
      source: _patchPath,
      patch: _parseJson5(readFileSync(join(root, _patchPath), "utf8"))
    }]
    return yield* runPipeline({
      spec,
      allowlist: allowlist.operationIds,
      patches,
      generate: { name: "Cinder", format: "httpapi" }
    })
  })

if (import.meta.main) {
  Effect.runPromise(generate()).then(
    ({ source, warnings }) => {
      for (const warning of warnings) console.warn("warning:", warning)
      writeFileSync(join(root, _outputPath), source)
      console.log(`cinder: wrote ${_outputPath} (${warnings.length} warnings)`)
    },
    (error) => {
      console.error("generate failed:", error)
      process.exit(1)
    }
  )
}
