import { assert, it } from "@effect/vitest"
import type { AddonSelectionInput } from "../src/registry.ts"
import { resolveAddons } from "../src/registry.ts"

const cloudConf = {
  authUrl: "https://auth.cloud.ovh.net/v3",
  region: "GRA",
  applicationCredentialId: "app-id",
  applicationCredentialSecret: "app-secret"
}

const allEnabled: AddonSelectionInput["addons"] = {
  cloud_controller_manager: true,
  cinder_csi: { enabled: true, default_volume_type: "classic" },
  system_upgrade_controller: true,
  cni: "cilium"
}

const _names = (input: AddonSelectionInput) => resolveAddons(input).map((a) => a.name)

it("k3s + cilium capability granted: all four, in install order", () => {
  assert.deepStrictEqual(
    _names({ distro: "k3s", addons: allEnabled, capabilities: ["cilium"], cloudConf }),
    ["cilium", "openstack-ccm", "cinder-csi", "system-upgrade-controller"]
  )
})

it("k3s without the cilium capability: cilium is gated out even though toggled on", () => {
  assert.deepStrictEqual(
    _names({ distro: "k3s", addons: allEnabled, capabilities: [], cloudConf }),
    ["openstack-ccm", "cinder-csi", "system-upgrade-controller"]
  )
})

it("ovh-mks: OVH-managed addons skipped regardless of toggles", () => {
  // cilium+ovh-mks is itself an invalid combination, rejected upstream by
  // core's validateCni (packages/core/src/ports/validation.ts) before this
  // registry is ever consulted — cni: "flannel" is the only config that
  // reaches here under ovh-mks.
  assert.deepStrictEqual(
    _names({ distro: "ovh-mks", addons: { ...allEnabled, cni: "flannel" }, capabilities: [], cloudConf }),
    []
  )
})

it("respects individual toggles being off", () => {
  assert.deepStrictEqual(
    _names({
      distro: "k3s",
      addons: { ...allEnabled, cni: "flannel", system_upgrade_controller: false },
      capabilities: [],
      cloudConf
    }),
    ["openstack-ccm", "cinder-csi"]
  )
})
