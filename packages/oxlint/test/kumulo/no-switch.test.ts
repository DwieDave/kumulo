import { noSwitch } from "../../src/oxlint/rules/no-switch.ts"
import { RuleTester } from "../rule-tester.ts"

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } })

tester.run("kumulo/no-switch", noSwitch, {
  valid: ["const a = x ? 1 : 2", "if (x) { y() }"],
  invalid: [
    { code: "switch (x) { case 1: break }", errors: [{ message: /Avoid `switch`/ }] },
    { code: "function f(x) { switch (x) { default: return 1 } }", errors: [{ message: /Avoid `switch`/ }] }
  ]
})
