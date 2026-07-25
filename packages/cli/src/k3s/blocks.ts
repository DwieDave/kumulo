import type { ClusterConfig } from "@kumulo/core"

type Required<K extends keyof ClusterConfig> = NonNullable<ClusterConfig[K]>

/**
 * The k3s-only config blocks (`K3S_ONLY_BLOCKS` in core's schema) are optional
 * in `ClusterConfig` — managed distros omit them — but schema-guaranteed
 * present when `distro: k3s`, the only path that reads them. The fallbacks
 * here exist purely to keep the accessor total for the type system; they are
 * unreachable after a successful decode. Lives in its own module (not
 * `env.ts`) so `provider/registry.ts` can use it without an import cycle.
 */
export const k3sBlocks = (config: ClusterConfig): {
  network: Required<"network">
  api_server: Required<"api_server">
  ssh: Required<"ssh">
  masters: Required<"masters">
  addons: Required<"addons">
  k3s: Required<"k3s">
} => ({
  network: config.network ?? { cidr: "10.0.0.0/16", public_access: "nat" },
  api_server: config.api_server ?? { high_availability: false, allowed_cidrs: [] },
  ssh: config.ssh ?? { public_key_path: "~/.ssh/id_ed25519.pub", allowed_cidrs: [] },
  masters: config.masters ?? { flavor: "", count: 0, image: "" },
  addons: config.addons ?? {
    cloud_controller_manager: false,
    cinder_csi: { enabled: false, default_volume_type: "classic" },
    hcloud_csi: { enabled: false },
    system_upgrade_controller: false,
    cni: "flannel"
  },
  k3s: config.k3s ?? { extra_server_args: [], extra_agent_args: [] }
})
