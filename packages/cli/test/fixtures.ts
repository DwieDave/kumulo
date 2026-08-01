import { Effect } from "effect"
import { decodeConfig } from "../src/cluster-config.ts"
import type { ClusterConfig, ClusterConfigEncoded, K3sClusterConfig, K3sClusterConfigEncoded, MksClusterConfig, MksClusterConfigEncoded, UpcloudUksClusterConfig } from "../src/cluster-config.ts"

export const baseEncodedConfig: K3sClusterConfigEncoded = {
  name: "prod-eu",
  provider: "ovh",
  distro: "k3s",
  version: "v1.31.4+k3s1",
  auth: { method: "application_credential", region: "GRA11" },
  network: { cidr: "10.0.0.0/16", public_access: "bastionless" },
  api_server: { high_availability: true, allowed_cidrs: ["203.0.113.0/24"] },
  ssh: { public_key_path: "~/.ssh/id_ed25519.pub", allowed_cidrs: ["203.0.113.0/24"] },
  masters: { flavor: "b3-8", count: 3, image: "ubuntu-24.04" },
  worker_pools: [
    { name: "general", flavor: "b3-16", count: 2, labels: { workload: "general" } }
  ],
  dns: { module: "none" },
  volumes: { module: "none" },
  object_storage: { module: "none" },
  secrets: { sink: "none" },
  addons: {
    cloud_controller_manager: false,
    cinder_csi: { enabled: false, default_volume_type: "high-speed" },
    hcloud_csi: { enabled: false },
    system_upgrade_controller: false,
    cni: "flannel"
  },
  k3s: { extra_server_args: [], extra_agent_args: [] }
}

export const baseMksEncodedConfig: MksClusterConfigEncoded = {
  name: "prod-eu",
  provider: "ovh",
  distro: "ovh-mks",
  version: "v1.31.4",
  auth: { method: "application_credential", region: "GRA11" },
  worker_pools: [
    { name: "general", flavor: "b3-16", count: 2, labels: { workload: "general" } }
  ],
  dns: { module: "none" },
  volumes: { module: "none" },
  object_storage: { module: "none" },
  secrets: { sink: "none" }
}

export const decodeTestConfig = (encoded: ClusterConfigEncoded): ClusterConfig =>
  Effect.runSync(decodeConfig(encoded))

export const decodeUpcloudTestConfig = (encoded: ClusterConfigEncoded): UpcloudUksClusterConfig => {
  const config = decodeTestConfig(encoded)
  if (config.distro !== "upcloud-uks") throw new Error(`expected an upcloud-uks config, got ${config.distro}`)
  return config
}

export const decodeMksTestConfig = (encoded: MksClusterConfigEncoded): MksClusterConfig => {
  const config = decodeTestConfig(encoded)
  if (config.distro !== "ovh-mks") throw new Error(`expected an ovh-mks config, got ${config.distro}`)
  return config
}

export const decodeK3sTestConfig = (encoded: K3sClusterConfigEncoded): K3sClusterConfig => {
  const config = decodeTestConfig(encoded)
  if (config.distro !== "k3s") throw new Error(`expected a k3s config, got ${config.distro}`)
  return config
}
