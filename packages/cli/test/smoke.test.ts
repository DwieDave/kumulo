import { assert, it } from "@effect/vitest"
import { kumuloCli, packageName } from "../src/index.ts"

it("resolves the package export and the command tree", () => {
  assert.strictEqual(packageName, "@kumulo/cli")
  assert.isDefined(kumuloCli)
})
