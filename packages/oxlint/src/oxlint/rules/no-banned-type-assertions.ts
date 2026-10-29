import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

const BANNED_KEYWORDS = new Set(["TSAnyKeyword", "TSUnknownKeyword", "TSNeverKeyword"])

function _bannedTargetKind(node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): string | null {
  const ann = node.typeAnnotation

  if (BANNED_KEYWORDS.has(ann.type)) return ann.type.replace(/^TS|Keyword$/g, "").toLowerCase()

  return null
}

function _isDoubleAssertion(node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): boolean {
  return node.expression.type === "TSAsExpression" || node.expression.type === "TSTypeAssertion"
}

export const noBannedTypeAssertions = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Hard-ban the worst type assertions: `as any` / `as unknown` / `as never` and double assertions."
    }
  },
  create(context) {
    function report(node: ESTree.TSAsExpression | ESTree.TSTypeAssertion) {
      const banned = _bannedTargetKind(node)

      if (banned) {
        context.report({
          node,
          message: `\`as ${banned}\` is banned — silently disables the type checker.`
        })

        return
      }

      if (_isDoubleAssertion(node)) {
        context.report({
          node,
          message: "Double type assertions (`x as A as B`) are banned."
        })
      }
    }

    return {
      TSAsExpression: report,
      TSTypeAssertion: report
    }
  }
})
