import { privateFunctionPrefix } from "../../src/oxlint/rules/private-function-prefix.ts"
import { RuleTester } from "../rule-tester.ts"

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } })

tester.run("kumulo/private-function-prefix", privateFunctionPrefix, {
  valid: [
    "export function foo() {}",
    "function _foo() {}",
    "const _foo = () => 1",
    "export const foo = () => 1",
    "export default function foo() {}",
    "const value = 1",
    "function outer() {}\nexport { outer }".replace("function outer", "function _outer"),
    "export function outer() { function inner() {} }"
  ],
  invalid: [
    { code: "function foo() {}", errors: [{ message: /must be prefixed with `_`/ }] },
    { code: "const foo = () => 1", errors: [{ message: /`foo` must be prefixed/ }] },
    { code: "const foo = function () {}", errors: [{ message: /`foo` must be prefixed/ }] },
    { code: "const a = () => 1, _b = () => 2", errors: [{ message: /`a` must be prefixed/ }] }
  ]
})
