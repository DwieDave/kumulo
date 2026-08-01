import type { Addon } from "@kumulo/core"
import type { Capability, DistroKind, K8sManifest } from "@kumulo/core"
import { Effect } from "effect"
import type { CloudConf } from "./cloud-conf.ts"
import { ciliumManifests } from "./manifests/cilium.ts"
import { cinderCsiManifests } from "./manifests/cinder-csi.ts"
import { hcloudCcmManifests } from "./manifests/hcloud-ccm.ts"
import { hcloudCsiManifests } from "./manifests/hcloud-csi.ts"
import { openstackCcmManifests } from "./manifests/openstack-ccm.ts"
import { systemUpgradeControllerManifests } from "./manifests/system-upgrade-controller.ts"

export interface AddonToggles {
  readonly cloud_controller_manager: boolean
  readonly cinder_csi: { readonly enabled: boolean; readonly default_volume_type: string }
  readonly hcloud_csi: { readonly enabled: boolean }
  readonly system_upgrade_controller: boolean
  readonly cni: "flannel" | "cilium"
}

export type CloudCredential =
  | ({ readonly provider: "openstack" } & CloudConf)
  | { readonly provider: "hetzner"; readonly token: string }

export interface AddonSelectionInput {
  readonly distro: DistroKind
  readonly addons: AddonToggles
  readonly capabilities: ReadonlyArray<Capability>
  readonly cloudCredential: CloudCredential
}

const OVH_MANAGED_ADDONS: ReadonlySet<string> = new Set(["openstack-ccm", "cinder-csi", "system-upgrade-controller"])

interface AsAddonParams {
  readonly name: string
  readonly requiredCapabilities: ReadonlyArray<Capability>
  readonly manifests: ReadonlyArray<K8sManifest>
}

const _asAddon = ({ name, requiredCapabilities, manifests }: AsAddonParams): Addon["Service"] => ({
  name,
  requiredCapabilities,
  manifests: () => Effect.succeed(manifests)
})

const _ccmAddon = (cloudCredential: CloudCredential): Addon["Service"] =>
  cloudCredential.provider === "hetzner"
    ? _asAddon({ name: "hcloud-ccm", requiredCapabilities: [], manifests: hcloudCcmManifests({ token: cloudCredential.token }) })
    : _asAddon({ name: "openstack-ccm", requiredCapabilities: [], manifests: openstackCcmManifests(cloudCredential) })

const _csiAddon = (input: AddonSelectionInput): Addon["Service"] | undefined => {
  const { cloudCredential } = input
  if (cloudCredential.provider === "hetzner") {
    return input.addons.hcloud_csi.enabled
      ? _asAddon({ name: "hcloud-csi", requiredCapabilities: [], manifests: hcloudCsiManifests({ token: cloudCredential.token }) })
      : undefined
  }
  return input.addons.cinder_csi.enabled
    ? _asAddon({
      name: "cinder-csi",
      requiredCapabilities: [],
      manifests: cinderCsiManifests({ conf: cloudCredential, defaultVolumeType: input.addons.cinder_csi.default_volume_type })
    })
    : undefined
}

const _toggledOn = (input: AddonSelectionInput): ReadonlyArray<Addon["Service"]> => {
  const csi = _csiAddon(input)
  return [
    ...(input.addons.cni === "cilium"
      ? [_asAddon({ name: "cilium", requiredCapabilities: ["cilium"], manifests: ciliumManifests() })]
      : []),
    ...(input.addons.cloud_controller_manager ? [_ccmAddon(input.cloudCredential)] : []),
    ...(csi === undefined ? [] : [csi]),
    ...(input.addons.system_upgrade_controller
      ? [_asAddon({ name: "system-upgrade-controller", requiredCapabilities: [], manifests: systemUpgradeControllerManifests() })]
      : [])
  ]
}

export interface GateAddonsParams {
  readonly all: ReadonlyArray<Addon["Service"]>
  readonly capabilities: ReadonlyArray<Capability>
  readonly distro: DistroKind
}

export const gateAddons = ({ all, capabilities, distro }: GateAddonsParams): ReadonlyArray<Addon["Service"]> =>
  all
    .filter((addon) => addon.requiredCapabilities.every((cap) => capabilities.includes(cap)))
    .filter((addon) => distro !== "ovh-mks" || !OVH_MANAGED_ADDONS.has(addon.name))

export const resolveAddons = (input: AddonSelectionInput): ReadonlyArray<Addon["Service"]> =>
  gateAddons({ all: _toggledOn(input), capabilities: input.capabilities, distro: input.distro })
