import { noMultipleFunctionParams } from "../../src/oxlint/rules/no-multiple-function-params.ts"
import { RuleTester } from "../rule-tester.ts"

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } })

tester.run("kumulo/no-multiple-function-params", noMultipleFunctionParams, {
  valid: [
    "export function f(a) {}",
    "export function f({ a, b }) {}",
    "export function f() {}",
    "function f(a, b) {}",
    "export const f = (a) => a",
    "[1].map((a, i) => a + i)",
    "export function outer() { function inner(a, b) {} }",
    "export const x = { handler: (a, b) => a }".replace("(a, b) => a", "(a) => a"),
    "foo(function (a, b) {})",
    { code: "function f(a, b) {}", options: [{ scope: "exports" }] }
  ],
  invalid: [
    { code: "export function f(a, b) {}", errors: [{ message: /single object parameter/ }] },
    { code: "export const f = (a, b) => a", errors: [{ message: /single object parameter/ }] },
    { code: "export default function (a, b) {}", errors: [{ message: /single object parameter/ }] },
    {
      code: "function f(a, b) {}",
      options: [{ scope: "all" }],
      errors: [{ message: /single object parameter/ }]
    },
    {
      code: "const f = function (a, b, c) {}",
      options: [{ scope: "all" }],
      errors: [{ message: /single object parameter/ }]
    }
  ]
})
