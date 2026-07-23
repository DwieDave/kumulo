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

/**
 * Stage 1: keep only operations whose operationId is in the allowlist.
 * Fails loudly if an allowlist entry matches nothing (typo guard).
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
  return Effect.succeed({ ...args.spec, paths })
}
