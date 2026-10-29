import { assert, it } from "@effect/vitest"
import type { Schema } from "effect"
import { readFileSync } from "node:fs"
import { hcloudCcmManifests } from "../../src/cluster/hcloud-ccm.ts"
import { hcloudCsiManifests } from "../../src/cluster/hcloud-csi.ts"

const credential = { token: "hcloud-token", network: "kumulo-prod" }

const _golden = (name: string): Schema.Json =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"))

it("hcloud-ccm manifests match the golden fixture", () => {
  assert.deepStrictEqual(hcloudCcmManifests(credential), _golden("hcloud-ccm"))
})

it("hcloud-csi manifests match the golden fixture", () => {
  assert.deepStrictEqual(hcloudCsiManifests(credential), _golden("hcloud-csi"))
})
