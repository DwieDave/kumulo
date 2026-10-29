import { defineRule } from "@oxlint/plugins"
import type { Context, ESTree } from "@oxlint/plugins"

function _isExportedDeclaration(node: ESTree.Node): boolean {
  const parent = node.parent

  if (!parent) return false

  return parent.type === "ExportNamedDeclaration" || parent.type === "ExportDefaultDeclaration"
}

function _isTopLevelDeclaration(node: ESTree.Node): boolean {
  const parent = node.parent

  if (!parent) return false

  if (parent.type === "Program") return true

  if (parent.type === "ExportNamedDeclaration" || parent.type === "ExportDefaultDeclaration") {
    return parent.parent?.type === "Program"
  }

  return false
}

function _reportIfBare(
  context: Context,
  node: ESTree.Node,
  name: string | undefined
) {
  if (!name) return

  if (name.startsWith("_")) return
  context.report({
    node,
    message: `Private function \`${name}\` must be prefixed with \`_\` (e.g. \`_${name}\`).`
  })
}

export const privateFunctionPrefix = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Non-exported top-level functions must be prefixed with `_`." }
  },
  create(context) {
    return {
      FunctionDeclaration(node) {
        if (!_isTopLevelDeclaration(node)) return

        if (_isExportedDeclaration(node)) return

        _reportIfBare(context, node, node.id?.name)
      },
      VariableDeclaration(node) {
        if (!_isTopLevelDeclaration(node)) return

        if (_isExportedDeclaration(node)) return

        for (const decl of node.declarations) {
          const init = decl.init

          if (!init) continue

          if (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression") {
            continue
          }

          const id = decl.id

          if (id.type !== "Identifier") continue
          _reportIfBare(context, decl, id.name)
        }
      }
    }
  }
})
