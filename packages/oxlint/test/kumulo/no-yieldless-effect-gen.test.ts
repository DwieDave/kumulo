import { noYieldlessEffectGen } from "../../src/oxlint/rules/no-yieldless-effect-gen.ts"
import { RuleTester } from "../rule-tester.ts"

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } })

tester.run("kumulo/no-yieldless-effect-gen", noYieldlessEffectGen, {
  valid: [
    "Effect.gen(function* () { yield* foo; return 1 })",
    "Effect.gen(function* () { if (a) { yield* foo } })",
    "Effect.gen(() => 1)",
    "Effect.gen(function () { return 1 })",
    "Other.gen(function* () { return 1 })",
    "Effect.succeed(1)",
    "Effect.gen()"
  ],
  invalid: [
    { code: "Effect.gen(function* () { return 1 })", errors: [{ message: /has no `yield\*`/ }] },
    { code: "Effect.gen(function* () {})", errors: [{ message: /has no `yield\*`/ }] },
    {
      code: "Effect.gen(function* () { const f = () => 1; return f() })",
      errors: [{ message: /has no `yield\*`/ }]
    }
  ]
})
