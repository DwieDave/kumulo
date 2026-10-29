import { assert, it } from "@effect/vitest"
import type { Schema } from "effect"
import { readFileSync } from "node:fs"
import { ciliumAddon } from "../../src/addons/cilium.ts"
import { systemUpgradeControllerAddon } from "../../src/addons/system-upgrade-controller.ts"

const _golden = (name: string): Schema.Json =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"))

it("cilium addon manifests match the golden fixture", () => {
  assert.strictEqual(ciliumAddon.name, "cilium")
  assert.deepStrictEqual(ciliumAddon.manifests, _golden("cilium"))
})

it("system-upgrade-controller addon manifests match the golden fixture", () => {
  assert.strictEqual(systemUpgradeControllerAddon.name, "system-upgrade-controller")
  assert.deepStrictEqual(systemUpgradeControllerAddon.manifests, _golden("system-upgrade-controller"))
})
