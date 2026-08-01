import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import { applyPatches, generateSource, type NamedPatch } from "codegen"
import { convert } from "ovh2openapi"
import type { OvhModel, OvhSchema } from "ovh2openapi"
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi"

const root = import.meta.dirname
const pkgRoot = join(root, "..")

interface AllowlistOp {
  readonly path: string
  readonly method: string
}

const _refModelKeys = (fullType: string, models: Record<string, OvhModel>): Array<string> =>
  Object.keys(models).filter((key) => new RegExp(`(^|[^A-Za-z0-9_.])${key.replace(/\./g, "\\.")}([^A-Za-z0-9_.]|$)`).test(fullType))

const _closeModels = (roots: ReadonlyArray<string>, models: Record<string, OvhModel>): Record<string, OvhModel> => {
  const kept: Record<string, OvhModel> = {}
  const stack = [...roots]
  while (stack.length > 0) {
    const key = stack.pop()
    if (key === undefined) break
    if (kept[key] || !models[key]) continue
    const model = models[key]
    kept[key] = model
    if ("enum" in model) continue
    for (const prop of Object.values(model.properties)) {
      for (const refKey of _refModelKeys(prop.fullType, models)) stack.push(refKey)
    }
  }
  return kept
}

const _trimSchema = (schema: OvhSchema, ops: ReadonlyArray<AllowlistOp>): OvhSchema => {
  const byPath = new Map(ops.map((op) => [op.path, new Set(ops.filter((o) => o.path === op.path).map((o) => o.method))]))
  const apis = schema.apis
    .filter((api) => byPath.has(api.path))
    .map((api) => ({ ...api, operations: api.operations.filter((op) => byPath.get(api.path)?.has(op.httpMethod) === true) }))
    .filter((api) => api.operations.length > 0)

  const modelRoots = apis.flatMap((api) =>
    api.operations.flatMap((op) => [
      ...op.parameters.flatMap((p) => _refModelKeys(p.fullType, schema.models)),
      ...(op.responseType ? _refModelKeys(op.responseType, schema.models) : [])
    ])
  )
  return { ...schema, apis, models: _closeModels(modelRoots, schema.models) }
}

interface AllowlistFile {
  readonly spec: string
  readonly operations: ReadonlyArray<AllowlistOp>
}

const _isOpenApiSpec = (value: unknown): value is OpenAPISpec =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "openapi" in value && "paths" in value

export const generate = () =>
  Effect.gen(function* () {
    const allowlist: AllowlistFile = JSON.parse(readFileSync(join(pkgRoot, "allowlist.json"), "utf8"))
    const schema: OvhSchema = JSON.parse(readFileSync(join(pkgRoot, allowlist.spec), "utf8"))
    const trimmed = _trimSchema(schema, allowlist.operations)
    const document = yield* convert(trimmed)

    const patchText = readFileSync(join(pkgRoot, "patches/storage.patch.json5"), "utf8").replace(/\/\/.*$/gm, "")
    const patches: ReadonlyArray<NamedPatch> = [{ source: "patches/storage.patch.json5", patch: JSON.parse(patchText) }]
    const patched = yield* applyPatches({ patches, document })
    if (!_isOpenApiSpec(patched)) return yield* Effect.die(new Error("patched storage document lost its OpenAPISpec shape"))

    return yield* generateSource({ spec: patched, options: { name: "Storage", format: "httpclient" } })
  })

if (import.meta.main) {
  Effect.runPromise(
    generate().pipe(
      Effect.map(({ source, warnings }) => {
        for (const warning of warnings) console.warn("warning:", warning)
        writeFileSync(join(pkgRoot, "src/generated/client.ts"), source)
        console.log(`generated src/generated/client.ts`)
      })
    )
  ).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
