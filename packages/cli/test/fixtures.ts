import { Effect } from "effect"
import { decodeConfig } from "@kumulo/core"
import type { ClusterConfig, ClusterConfigEncoded, K3sClusterConfig, K3sClusterConfigEncoded, MksClusterConfigEncoded } from "@kumulo/core"

/** Same base fixture core's own tests use (see `test/k3s/plan.test.ts`), dns overridable per test. */
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
  dns: { module: "none", zone: "example.com", ttl: 300, records: [] },
  volumes: { module: "none", managed: [] },
  object_storage: { module: "none", buckets: [] },
  secrets: { sink: "none", dir: "." },
  addons: {
    cloud_controller_manager: false,
    cinder_csi: { enabled: false, default_volume_type: "high-speed" },
    hcloud_csi: { enabled: false },
    system_upgrade_controller: false,
    cni: "flannel"
  },
  k3s: { extra_server_args: [], extra_agent_args: [] }
}

/** The ovh-mks counterpart: only the fields that variant actually has. */
export const baseMksEncodedConfig: MksClusterConfigEncoded = {
  name: "prod-eu",
  provider: "ovh",
  distro: "ovh-mks",
  version: "v1.31.4",
  auth: { method: "application_credential", region: "GRA11" },
  worker_pools: [
    { name: "general", flavor: "b3-16", count: 2, labels: { workload: "general" } }
  ],
  dns: { module: "none", zone: "example.com", ttl: 300, records: [] },
  volumes: { module: "none", managed: [] },
  object_storage: { module: "none", buckets: [] },
  secrets: { sink: "none", dir: "." }
}

/** Decode through the real schema so test configs are honest `ClusterConfig`s, no casts. */
export const decodeTestConfig = (encoded: ClusterConfigEncoded): ClusterConfig =>
  Effect.runSync(decodeConfig(encoded))

/** Same decode, narrowed to the k3s variant for the k3s-only modules (throws if the fixture is not k3s). */
export const decodeK3sTestConfig = (encoded: K3sClusterConfigEncoded): K3sClusterConfig => {
  const config = decodeTestConfig(encoded)
  if (config.distro !== "k3s") throw new Error(`expected a k3s config, got ${config.distro}`)
  return config
}
