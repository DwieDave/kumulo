import { assert, it } from "@effect/vitest"
import { hetznerClusterAddons } from "../../src/cluster/addons.ts"
import { hcloudCcmManifests } from "../../src/cluster/hcloud-ccm.ts"
import { hcloudCsiManifests } from "../../src/cluster/hcloud-csi.ts"

const _names = (input: Parameters<typeof hetznerClusterAddons>[0]) => hetznerClusterAddons(input).map((a) => a.name)

it("returns nothing when ccm and csi are off", () => {
  assert.deepStrictEqual(_names({ token: "t", ccm: false, csi: false }), [])
})

it("returns only ccm", () => {
  assert.deepStrictEqual(_names({ token: "t", ccm: true, csi: false }), ["hcloud-ccm"])
})

it("returns only csi", () => {
  assert.deepStrictEqual(_names({ token: "t", ccm: false, csi: true }), ["hcloud-csi"])
})

it("returns ccm before csi", () => {
  assert.deepStrictEqual(_names({ token: "t", ccm: true, csi: true }), ["hcloud-ccm", "hcloud-csi"])
})

it("passes network through to the manifests", () => {
  const addons = hetznerClusterAddons({ token: "t", network: "n", ccm: true, csi: true })
  assert.deepStrictEqual(addons[0]?.manifests, hcloudCcmManifests({ token: "t", network: "n" }))
  assert.deepStrictEqual(addons[1]?.manifests, hcloudCsiManifests({ token: "t", network: "n" }))
})

it("omits network when not supplied", () => {
  const addons = hetznerClusterAddons({ token: "t", ccm: true, csi: false })
  assert.deepStrictEqual(addons[0]?.manifests, hcloudCcmManifests({ token: "t" }))
})
