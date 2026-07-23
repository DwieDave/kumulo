import { Effect } from "effect"
import type { OpenAPISpec, OpenAPISpecPathItem, OpenAPISpecMethodName } from "effect/unstable/httpapi/OpenApi"
import { AllowlistOperationNotFound } from "./errors.ts"

const _methodNames: ReadonlyArray<OpenAPISpecMethodName> = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace"
]

const _filterPathItem = (args: { readonly item: OpenAPISpecPathItem; readonly allowed: ReadonlySet<string> }): OpenAPISpecPathItem => {
  const kept: OpenAPISpecPathItem = {}
  for (const method of _methodNames) {
    const op = args.item[method]
    if (op !== undefined && args.allowed.has(op.operationId)) kept[method] = op
  }
  return kept
}

const _matchedOperationIds = (spec: OpenAPISpec): Set<string> => {
  const matched = new Set<string>()
  for (const item of Object.values(spec.paths)) {
    for (const method of _methodNames) {
      const op = item[method]
      if (op !== undefined) matched.add(op.operationId)
    }
  }
  return matched
}

const _schemaRefPrefix = "#/components/schemas/"

// kumulo: walks an arbitrary JSON-ish value collecting every "#/components/schemas/X"
// $ref it finds, so pruned specs don't retain unused component schemas (which the
// generator otherwise emits in full, even for allowlist entries as small as 1 op).
const _collectSchemaRefs = (value: unknown, into: Set<string>): void => {
  if (Array.isArray(value)) {
    for (const item of value) _collectSchemaRefs(item, into)
    return
  }
  if (typeof value !== "object" || value === null) return
  for (const [key, nested] of Object.entries(value)) {
    if (key === "$ref" && typeof nested === "string" && nested.startsWith(_schemaRefPrefix)) {
      into.add(nested.slice(_schemaRefPrefix.length))
    } else {
      _collectSchemaRefs(nested, into)
    }
  }
}

// kumulo: transitive closure over $ref edges starting from the surviving paths, so a
// referenced schema's own referenced schemas (e.g. Widget -> WidgetOwner) are kept too.
const _reachableSchemaNames = (args: {
  readonly paths: Record<string, OpenAPISpecPathItem>
  readonly schemas: Record<string, unknown>
}): Set<string> => {
  const reachable = new Set<string>()
  _collectSchemaRefs(args.paths, reachable)
  const queue = [...reachable]
  while (queue.length > 0) {
    const name = queue.pop()
    const schema = name !== undefined ? args.schemas[name] : undefined
    if (schema === undefined) continue
    const before = reachable.size
    _collectSchemaRefs(schema, reachable)
    if (reachable.size > before) queue.push(...reachable)
  }
  return reachable
}

const _pruneSchemas = (args: {
  readonly spec: OpenAPISpec
  readonly paths: Record<string, OpenAPISpecPathItem>
}): OpenAPISpec["components"] => {
  const schemas = args.spec.components?.schemas ?? {}
  const reachable = _reachableSchemaNames({ paths: args.paths, schemas })
  return {
    ...args.spec.components,
    schemas: Object.fromEntries(Object.entries(schemas).filter(([name]) => reachable.has(name)))
  }
}

/**
 * Stage 1: keep only operations whose operationId is in the allowlist, and prune
 * `components.schemas` down to whatever those surviving operations still reference
 * (transitively). Fails loudly if an allowlist entry matches nothing (typo guard).
 */
export const filterAllowlist = (args: {
  readonly spec: OpenAPISpec
  readonly allowlist: ReadonlyArray<string>
}): Effect.Effect<OpenAPISpec, AllowlistOperationNotFound> => {
  const allowed = new Set(args.allowlist)
  const paths: Record<string, OpenAPISpecPathItem> = {}
  for (const [path, item] of Object.entries(args.spec.paths)) {
    const kept = _filterPathItem({ item, allowed })
    if (Object.keys(kept).length > 0) paths[path] = kept
  }

  const matched = _matchedOperationIds({ ...args.spec, paths })
  const unmatched = args.allowlist.filter((id) => !matched.has(id))
  if (unmatched.length > 0) {
    return Effect.fail(new AllowlistOperationNotFound({ operationIds: unmatched }))
  }
  return Effect.succeed({ ...args.spec, paths, components: _pruneSchemas({ spec: args.spec, paths }) })
}
