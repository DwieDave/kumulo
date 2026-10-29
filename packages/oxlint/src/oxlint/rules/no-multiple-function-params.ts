import { defineRule } from "@oxlint/plugins"
import type { Context, ESTree } from "@oxlint/plugins"

const MESSAGE = "Functions with more than one parameter must take a single object parameter (named-args)."

type Scope = "all" | "exports"

const _isScope = (value: unknown): value is Scope => value === "all" || value === "exports"

const _isInsideExport = (node: ESTree.Node): boolean => {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    const t = ancestor.type

    if (
      t === "ExportNamedDeclaration" ||
      t === "ExportDefaultDeclaration" ||
      t === "ExportAllDeclaration"
    ) {
      return true
    }
  }

  return false
}

const _scopeFrom = (context: Context): Scope => {
  const opt = context.options[0]

  if (opt instanceof Object && "scope" in opt && _isScope(opt.scope)) {
    return opt.scope
  }

  return "exports"
}

const FUNCTION_LIKE = new Set<string>([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression"
])

const _isInlineCallback = (node: ESTree.Node): boolean => {
  // Inline callback: walk up past Property/ObjectExpression/ArrayExpression to a Call/New (exempt) or anything else (not exempt).
  for (let p = node.parent; p; p = p.parent) {
    const t = p.type

    if (t === "CallExpression" || t === "NewExpression") return true

    if (t === "ArrayExpression") continue

    if (t === "ObjectExpression" || t === "Property") continue

    return false
  }

  return false
}

const _isNestedInsideFunction = (node: ESTree.Node): boolean => {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (FUNCTION_LIKE.has(ancestor.type)) return true
  }

  return false
}

function _check(context: Context, node: ESTree.Function | ESTree.ArrowFunctionExpression, scope: Scope) {
  if (node.params.length <= 1) return

  if (_isInlineCallback(node)) return

  if (_isNestedInsideFunction(node)) return

  if (scope === "exports" && !_isInsideExport(node)) return
  context.report({ node, message: MESSAGE })
}

export const noMultipleFunctionParams = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Multi-arg functions must accept a single object parameter. Default scope: 'exports' — internal helpers may take positional args. Callback TYPE annotations (TSFunctionType) and TS declare-function are exempt: a multi-arg callback contract is the caller's choice."
    },
    schema: [
      {
        type: "object",
        properties: {
          scope: { enum: ["all", "exports"] }
        },
        additionalProperties: false
      }
    ]
  },
  create(context) {
    const scope = _scopeFrom(context)

    return {
      FunctionDeclaration(node) {
        _check(context, node, scope)
      },
      FunctionExpression(node) {
        _check(context, node, scope)
      },
      ArrowFunctionExpression(node) {
        _check(context, node, scope)
      }
    }
  }
})
