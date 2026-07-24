import { assert, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import { ciliumManifests } from "../src/manifests/cilium.ts"
import { cinderCsiManifests } from "../src/manifests/cinder-csi.ts"
import { hcloudCcmManifests } from "../src/manifests/hcloud-ccm.ts"
import { hcloudCsiManifests } from "../src/manifests/hcloud-csi.ts"
import { openstackCcmManifests } from "../src/manifests/openstack-ccm.ts"
import { systemUpgradeControllerManifests } from "../src/manifests/system-upgrade-controller.ts"

const conf = {
  authUrl: "https://auth.cloud.ovh.net/v3",
  region: "GRA",
  applicationCredentialId: "app-id",
  applicationCredentialSecret: "app-secret"
}

const credential = { token: "hcloud-token", network: "kumulo-prod" }

const _golden = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"))

it("openstack-ccm manifests match the golden fixture", () => {
  assert.deepStrictEqual(openstackCcmManifests(conf), _golden("openstack-ccm"))
})

it("cinder-csi manifests match the golden fixture", () => {
  assert.deepStrictEqual(cinderCsiManifests({ conf, defaultVolumeType: "classic" }), _golden("cinder-csi"))
})

it("system-upgrade-controller manifests match the golden fixture", () => {
  assert.deepStrictEqual(systemUpgradeControllerManifests(), _golden("system-upgrade-controller"))
})

it("cilium manifests match the golden fixture", () => {
  assert.deepStrictEqual(ciliumManifests(), _golden("cilium"))
})

it("hcloud-ccm manifests match the golden fixture", () => {
  assert.deepStrictEqual(hcloudCcmManifests(credential), _golden("hcloud-ccm"))
})

it("hcloud-csi manifests match the golden fixture", () => {
  assert.deepStrictEqual(hcloudCsiManifests(credential), _golden("hcloud-csi"))
})
