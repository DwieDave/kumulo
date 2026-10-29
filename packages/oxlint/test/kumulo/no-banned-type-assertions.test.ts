import { noBannedTypeAssertions } from "../../src/oxlint/rules/no-banned-type-assertions.ts"
import { RuleTester } from "../rule-tester.ts"

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } })

tester.run("kumulo/no-banned-type-assertions", noBannedTypeAssertions, {
  valid: ["const a = x as string", "const a = x as const", "const a = <string>x"],
  invalid: [
    { code: "const a = x as any", errors: [{ message: "`as any` is banned — silently disables the type checker." }] },
    { code: "const a = x as unknown", errors: [{ message: "`as unknown` is banned — silently disables the type checker." }] },
    { code: "const a = x as never", errors: [{ message: "`as never` is banned — silently disables the type checker." }] },
    { code: "const a = <any>x", errors: [{ message: "`as any` is banned — silently disables the type checker." }] },
    {
      code: "const a = x as string as number",
      errors: [{ message: "Double type assertions (`x as A as B`) are banned." }]
    }
  ]
})
