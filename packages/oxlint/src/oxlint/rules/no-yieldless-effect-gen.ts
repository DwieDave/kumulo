import { defineRule } from "@oxlint/plugins"
import type { ESTree } from "@oxlint/plugins"

function _isEffectGenCallee(callee: ESTree.Expression | ESTree.Super): boolean {
  if (callee.type !== "MemberExpression") return false
  const object = callee.object
  const property = callee.property

  if (object.type !== "Identifier" || property.type !== "Identifier") return false

  if (object.name !== "Effect") return false

  if (property.name !== "gen") return false

  return true
}

function _isNode(value: Partial<ESTree.Node> | null): value is ESTree.Node {
  return value instanceof Object && "type" in value
}

function _hasYieldExpression(node: ESTree.Node): boolean {
  const stack: Array<ESTree.Node> = [node]

  while (stack.length > 0) {
    const cur = stack.pop()

    if (!cur) continue

    if (cur.type === "YieldExpression") return true

    for (const [key, v] of Object.entries(cur)) {
      if (key === "parent") continue

      if (Array.isArray(v)) {
        for (const item of v) {
          if (_isNode(item)) stack.push(item)
        }
      } else if (_isNode(v)) {
        stack.push(v)
      }
    }
  }

  return false
}

export const noYieldlessEffectGen = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid `Effect.gen(function*() { ... })` whose body has no `yield*` — use a plain expression with `Effect.succeed`/`Effect.sync`, or (for `Application.define({ build })`) a thunk."
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee

        if (!_isEffectGenCallee(callee)) return
        const fn = node.arguments[0]

        if (!fn) return

        if (fn.type !== "FunctionExpression") return

        if (!fn.generator) return
        const body = fn.body

        if (!body) return

        if (_hasYieldExpression(body)) return
        context.report({
          node: callee,
          message:
            "`Effect.gen(function*() { ... })` has no `yield*` — use `Effect.succeed(value)` (sync return), `Effect.sync(() => ...)`, or a thunk `() => value` if the consumer accepts one (e.g. `Application.define({ build })`)."
        })
      }
    }
  }
})
