import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

function _isAsConst(node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): boolean {
  const ann = node.typeAnnotation

  if (ann.type !== "TSTypeReference") return false
  const typeName = ann.typeName

  return typeName.type === "Identifier" && typeName.name === "const"
}

export const noTypeAssertion = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Discourage `as` type assertions — prefer schemas / narrowing." }
  },
  create(context) {
    function report(node: ESTree.TSAsExpression | ESTree.TSTypeAssertion) {
      if (_isAsConst(node)) return
      context.report({
        node,
        message: "Avoid `as` type assertions. Prefer schema decoding or proper narrowing."
      })
    }

    return {
      TSAsExpression: report,
      TSTypeAssertion: report
    }
  }
})
