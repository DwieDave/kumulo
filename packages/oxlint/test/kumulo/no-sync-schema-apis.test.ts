import { noSyncSchemaApis } from "../../src/oxlint/rules/no-sync-schema-apis.ts"
import { RuleTester } from "../rule-tester.ts"

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } })

tester.run("kumulo/no-sync-schema-apis", noSyncSchemaApis, {
  valid: [
    "Schema.decodeUnknownEffect(S)(x)",
    "Schema.decodeUnknownEither(S)(x)",
    "Other.decodeSync(S)(x)",
    "decodeSync(S)(x)",
    "Schema.decodeSync"
  ],
  invalid: [
    { code: "Schema.decodeSync(S)(x)", errors: [{ message: /`Schema.decodeSync` throws/ }] },
    { code: "S.encodeUnknownSync(S)(x)", errors: [{ message: /`S.encodeUnknownSync` throws/ }] },
    { code: "Schema.asserts(S)", errors: [{ message: /`Schema.asserts` throws/ }] }
  ]
})
