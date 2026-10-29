import { assert, it } from "@effect/vitest"
import { packageName } from "../src/index.ts"

it("resolves the package export", () => {
  assert.strictEqual(packageName, "@kumulo/distro-ovh-mks")
})
