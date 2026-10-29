import { assert, it } from "@effect/vitest"
import type { Schema } from "effect"
import { readFileSync } from "node:fs"
import { cinderCsiManifests } from "../../src/cluster/cinder-csi.ts"
import { openstackCcmManifests } from "../../src/cluster/openstack-ccm.ts"
import { openstackClusterAddons } from "../../src/index.ts"

const conf = {
  authUrl: "https://auth.cloud.ovh.net/v3",
  region: "GRA",
  applicationCredentialId: "app-id",
  applicationCredentialSecret: "app-secret"
}

const _golden = (name: string): Schema.Json =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"))

const _names = (input: Parameters<typeof openstackClusterAddons>[0]) =>
  openstackClusterAddons(input).map((addon) => addon.name)

it("openstack-ccm manifests match the golden fixture", () => {
  assert.deepStrictEqual(openstackCcmManifests(conf), _golden("openstack-ccm"))
})

it("cinder-csi manifests match the golden fixture", () => {
  assert.deepStrictEqual(cinderCsiManifests({ conf, defaultVolumeType: "classic" }), _golden("cinder-csi"))
})

it("selects addons in order", () => {
  assert.deepStrictEqual(_names({ conf, ccm: false, csi: false }), [])
  assert.deepStrictEqual(_names({ conf, ccm: true, csi: false }), ["openstack-ccm"])
  assert.deepStrictEqual(_names({ conf, ccm: false, csi: {} }), ["cinder-csi"])
  assert.deepStrictEqual(_names({ conf, ccm: true, csi: {} }), ["openstack-ccm", "cinder-csi"])
})

it("omits StorageClass parameters when defaultVolumeType is undefined", () => {
  const storageClass = cinderCsiManifests({ conf }).find((manifest) => manifest.kind === "StorageClass")
  assert.isDefined(storageClass)
  assert.isFalse(storageClass !== undefined && "parameters" in storageClass)
})
