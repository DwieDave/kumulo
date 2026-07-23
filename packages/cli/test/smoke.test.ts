import { assert, it } from "@effect/vitest"
import { coreDependency, packageName } from "../src/index.ts"

it("resolves the package export and links to @kumulo/core", () => {
  assert.strictEqual(packageName, "@kumulo/cli")
  assert.strictEqual(coreDependency, "@kumulo/core")
})
