/**
 * codegen:check — regen-is-noop CI gate.
 *
 * Reads `services.json` (a list of per-service pipeline configs), regenerates
 * each into memory, and diffs it against the committed output file. Empty
 * manifest exits 0 — no service pipelines are registered yet; this script is
 * the reusable gate they wire into.
 */
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import * as YAML from "yaml"
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi"
import { runPipeline } from "../pipeline.ts"
import { checkNoop } from "../regenCheck.ts"
import type { NamedPatch } from "../patch.ts"

interface ServiceEntry {
  readonly name: string
  readonly specPath: string
  readonly allowlistPath: string
  readonly patchPaths: ReadonlyArray<string>
  readonly format: "httpclient" | "httpclient-type-only" | "httpapi"
  readonly outputPath: string
}

const root = join(import.meta.dirname, "..", "..")

// kumulo: vendored specs are YAML, allowlists carry {service,spec,operationIds}
// (not a bare array), and patches are JSON5 (`// why` comments) — strip line
// comments before JSON.parse rather than pull in a full JSON5 dependency.
const _stripJsonComments = (text: string): string => text.replace(/\/\/.*$/gm, "")

const _loadService = (entry: ServiceEntry) =>
  Effect.gen(function* () {
    const spec: OpenAPISpec = YAML.parse(readFileSync(join(root, entry.specPath), "utf8"))
    const allowlistDoc = JSON.parse(readFileSync(join(root, entry.allowlistPath), "utf8"))
    const allowlist: ReadonlyArray<string> = allowlistDoc.operationIds
    const patches: ReadonlyArray<NamedPatch> = entry.patchPaths.map((patchPath) => ({
      source: patchPath,
      patch: JSON.parse(_stripJsonComments(readFileSync(join(root, patchPath), "utf8")))
    }))
    const committed = readFileSync(join(root, entry.outputPath), "utf8")
    const { source } = yield* runPipeline({
      spec,
      allowlist,
      patches,
      generate: { name: entry.name, format: entry.format }
    })
    yield* checkNoop({ committedPath: entry.outputPath, committed, regenerated: source })
  })

const services: ReadonlyArray<ServiceEntry> = JSON.parse(readFileSync(join(root, "services.json"), "utf8"))

// The OVH-generated clients (mks, dns) run their own
// `ovh2openapi`-shaped pipeline (trim -> convert -> patch -> generate),
// registered separately from `services.json`'s httpapi-format OpenStack
// entries; still gated by the same "regen is a no-op" check.
interface OvhPipeline {
  readonly name: string
  readonly outputPath: string
  readonly generate: () => Effect.Effect<{ readonly source: string }, unknown>
}

const _loadOvhPipeline = (pipeline: OvhPipeline) =>
  Effect.gen(function* () {
    const committed = readFileSync(join(root, pipeline.outputPath), "utf8")
    const { source } = yield* pipeline.generate()
    yield* checkNoop({ committedPath: pipeline.outputPath, committed, regenerated: source })
  })

const _ovhPipelines: Effect.Effect<ReadonlyArray<OvhPipeline>> = Effect.promise(async () => [
  {
    name: "distro-ovh-mks",
    outputPath: "../../packages/distro-ovh-mks/src/generated/client.ts",
    generate: (await import("../../../../packages/distro-ovh-mks/scripts/generate.ts")).generate
  },
  {
    name: "dns-ovh",
    outputPath: "../../packages/dns-ovh/src/generated/client.ts",
    generate: (await import("../../../../packages/dns-ovh/scripts/generate.ts")).generate
  }
])

const program = Effect.gen(function* () {
  yield* Effect.forEach(services, _loadService, { discard: true })
  const ovhPipelines = yield* _ovhPipelines
  yield* Effect.forEach(ovhPipelines, _loadOvhPipeline, { discard: true })
  return services.length + ovhPipelines.length
})

Effect.runPromise(program).then(
  (count) => {
    console.log(`codegen:check — ${count} service pipeline(s) clean`)
  },
  (error) => {
    console.error("codegen:check — drift or pipeline failure:", error)
    process.exit(1)
  }
)
