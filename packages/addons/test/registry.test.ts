import { assert, it } from "@effect/vitest"
import type { AddonSelectionInput } from "../src/registry.ts"
import { resolveAddons } from "../src/registry.ts"

const openstackCredential = {
  provider: "openstack" as const,
  authUrl: "https://auth.cloud.ovh.net/v3",
  region: "GRA",
  applicationCredentialId: "app-id",
  applicationCredentialSecret: "app-secret"
}

const hetznerCredential = { provider: "hetzner" as const, token: "hcloud-token" }

const allEnabled: AddonSelectionInput["addons"] = {
  cloud_controller_manager: true,
  cinder_csi: { enabled: true, default_volume_type: "classic" },
  hcloud_csi: { enabled: true },
  system_upgrade_controller: true,
  cni: "cilium"
}

const _names = (input: AddonSelectionInput) => resolveAddons(input).map((a) => a.name)

it("k3s + cilium capability granted: all four, in install order", () => {
  assert.deepStrictEqual(
    _names({ distro: "k3s", addons: allEnabled, capabilities: ["cilium"], cloudCredential: openstackCredential }),
    ["cilium", "openstack-ccm", "cinder-csi", "system-upgrade-controller"]
  )
})

it("k3s without the cilium capability: cilium is gated out even though toggled on", () => {
  assert.deepStrictEqual(
    _names({ distro: "k3s", addons: allEnabled, capabilities: [], cloudCredential: openstackCredential }),
    ["openstack-ccm", "cinder-csi", "system-upgrade-controller"]
  )
})

it("ovh-mks: OVH-managed addons skipped regardless of toggles", () => {
  // cilium+ovh-mks is itself an invalid combination, rejected upstream by
  // core's validateCni (packages/core/src/ports/validation.ts) before this
  // registry is ever consulted — cni: "flannel" is the only config that
  // reaches here under ovh-mks.
  assert.deepStrictEqual(
    _names({ distro: "ovh-mks", addons: { ...allEnabled, cni: "flannel" }, capabilities: [], cloudCredential: openstackCredential }),
    []
  )
})

it("respects individual toggles being off", () => {
  assert.deepStrictEqual(
    _names({
      distro: "k3s",
      addons: { ...allEnabled, cni: "flannel", system_upgrade_controller: false },
      capabilities: [],
      cloudCredential: openstackCredential
    }),
    ["openstack-ccm", "cinder-csi"]
  )
})

it("hetzner credential: hcloud-ccm + hcloud-csi selected instead of the openstack pair", () => {
  assert.deepStrictEqual(
    _names({ distro: "k3s", addons: { ...allEnabled, cni: "flannel" }, capabilities: [], cloudCredential: hetznerCredential }),
    ["hcloud-ccm", "hcloud-csi", "system-upgrade-controller"]
  )
})

it("hetzner credential: hcloud_csi off leaves only hcloud-ccm", () => {
  assert.deepStrictEqual(
    _names({
      distro: "k3s",
      addons: { ...allEnabled, cni: "flannel", hcloud_csi: { enabled: false }, system_upgrade_controller: false },
      capabilities: [],
      cloudCredential: hetznerCredential
    }),
    ["hcloud-ccm"]
  )
})
