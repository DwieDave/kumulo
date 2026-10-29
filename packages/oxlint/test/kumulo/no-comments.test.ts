import { noComments } from "../../src/oxlint/rules/no-comments.ts"
import { RuleTester } from "../rule-tester.ts"

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } })

tester.run("kumulo/no-comments", noComments, {
  valid: [
    "const a = 1",
    "// short comment\nconst a = 1",
    "/** jsdoc */\nconst a = 1",
    "// eslint-disable-next-line no-console\nconst a = 1",
    "// oxlint-disable-next-line foo\nconst a = 1",
    "// @ts-expect-error nope\nconst a = 1",
    `// kumulo: WHY ${"x".repeat(200)}\nconst a = 1`
  ],
  invalid: [
    { code: "/* block */\nconst a = 1", errors: [{ message: /Non-JSDoc block comments/ }] },
    { code: `// ${"x".repeat(150)}\nconst a = 1`, errors: [{ message: /Comment exceeds 150 chars/ }] }
  ]
})
