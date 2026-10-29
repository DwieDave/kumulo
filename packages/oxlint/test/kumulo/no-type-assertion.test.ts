import { noTypeAssertion } from "../../src/oxlint/rules/no-type-assertion.ts"
import { RuleTester } from "../rule-tester.ts"

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } })

tester.run("kumulo/no-type-assertion", noTypeAssertion, {
  valid: ["const a = x as const", "const a = [1] as const", "const a: string = x"],
  invalid: [
    { code: "const a = x as string", errors: [{ message: /Avoid `as` type assertions/ }] },
    { code: "const a = <string>x", errors: [{ message: /Avoid `as` type assertions/ }] },
    { code: "const a = x as Foo<string>", errors: [{ message: /Avoid `as` type assertions/ }] }
  ]
})
