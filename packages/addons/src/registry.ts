import { Addon } from "@kumulo/core"
import type { Capability, DistroKind, K8sManifest } from "@kumulo/core"
import { Effect } from "effect"
import type { CloudConf } from "./cloud-conf.ts"
import { ciliumManifests } from "./manifests/cilium.ts"
import { cinderCsiManifests } from "./manifests/cinder-csi.ts"
import { openstackCcmManifests } from "./manifests/openstack-ccm.ts"
import { systemUpgradeControllerManifests } from "./manifests/system-upgrade-controller.ts"

export interface AddonToggles {
  readonly cloud_controller_manager: boolean
  readonly cinder_csi: { readonly enabled: boolean; readonly default_volume_type: string }
  readonly system_upgrade_controller: boolean
  readonly cni: "flannel" | "cilium"
}

export interface AddonSelectionInput {
  readonly distro: DistroKind
  readonly addons: AddonToggles
  readonly capabilities: ReadonlyArray<Capability>
  readonly cloudConf: CloudConf
}

// These three are always OVH-managed under ovh-mks (OCCM, cinder-csi
// preinstalled; SUC unneeded, OVH drives upgrades via its own API, see
// distro Port's `upgrade`) — skipped regardless of toggle state.
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

// Install order: CNI first (pods need networking before anything else
// schedules), then the two cloud-integration addons, then SUC last.
const _toggledOn = (input: AddonSelectionInput): ReadonlyArray<Addon["Service"]> => [
  ...(input.addons.cni === "cilium"
    ? [_asAddon({ name: "cilium", requiredCapabilities: ["cilium"], manifests: ciliumManifests() })]
    : []),
  ...(input.addons.cloud_controller_manager
    ? [_asAddon({ name: "openstack-ccm", requiredCapabilities: [], manifests: openstackCcmManifests(input.cloudConf) })]
    : []),
  ...(input.addons.cinder_csi.enabled
    ? [_asAddon({
      name: "cinder-csi",
      requiredCapabilities: [],
      manifests: cinderCsiManifests({
        conf: input.cloudConf,
        defaultVolumeType: input.addons.cinder_csi.default_volume_type
      })
    })]
    : []),
  ...(input.addons.system_upgrade_controller
    ? [_asAddon({ name: "system-upgrade-controller", requiredCapabilities: [], manifests: systemUpgradeControllerManifests() })]
    : [])
]

export interface GateAddonsParams {
  readonly all: ReadonlyArray<Addon["Service"]>
  readonly capabilities: ReadonlyArray<Capability>
  readonly distro: DistroKind
}

// Pure gating step, kept separate from toggle-resolution so the capability
// and MKS-subset-skip matrix is testable against a hand-built addon list.
export const gateAddons = ({ all, capabilities, distro }: GateAddonsParams): ReadonlyArray<Addon["Service"]> =>
  all
    .filter((addon) => addon.requiredCapabilities.every((cap) => capabilities.includes(cap)))
    .filter((addon) => distro !== "ovh-mks" || !OVH_MANAGED_ADDONS.has(addon.name))

// Toggled-on built-ins, in install order, capability- and MKS-subset-gated.
export const resolveAddons = (input: AddonSelectionInput): ReadonlyArray<Addon["Service"]> =>
  gateAddons({ all: _toggledOn(input), capabilities: input.capabilities, distro: input.distro })
