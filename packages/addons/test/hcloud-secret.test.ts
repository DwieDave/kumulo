import { assert, it } from "@effect/vitest"
import { hcloudSecretManifest } from "../src/hcloud-secret.ts"

it("renders token-only when no network is supplied", () => {
  assert.deepStrictEqual(hcloudSecretManifest({ token: "t" }).stringData, { token: "t" })
})

it("renders both token and network when network routing is enabled", () => {
  assert.deepStrictEqual(hcloudSecretManifest({ token: "t", network: "n" }).stringData, { network: "n", token: "t" })
})
