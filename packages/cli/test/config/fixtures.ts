import type { K3sClusterConfigEncoded, MksClusterConfigEncoded, UpcloudUksClusterConfigEncoded } from "../../src/cluster-config.ts"

export const validConfig: K3sClusterConfigEncoded = {
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
    { name: "general", flavor: "b3-16", count: 4, labels: { workload: "general" } },
    {
      name: "highmem",
      flavor: "r2-30",
      count: 2,
      labels: { workload: "memory" },
      taints: ["dedicated=memory:NoSchedule"],
      autoscaling: { enabled: false, min: 2, max: 6 }
    }
  ],
  dns: {
    module: "ovh",
    zone: "example.com",
    ttl: 300,
    records: [
      { name: "api.prod-eu", target: "api_server" },
      { name: "*.apps.prod-eu", target: "ingress" }
    ]
  },
  volumes: {
    module: "cinder",
    managed: [
      {
        name: "postgres-data",
        size_gb: 100,
        type: "high-speed",
        retain: true,
        pvc: { namespace: "db", access_modes: ["ReadWriteOnce"] }
      }
    ]
  },
  object_storage: {
    module: "ovh",
    buckets: [
      { name: "staging-eu-backups", region: "DE1", versioning: false, encryption: false, retain: true }
    ]
  },
  secrets: {
    sink: "sops",
    dir: ".",
    sops: { age_recipient: "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqql4pcnf" }
  },
  addons: {
    cloud_controller_manager: true,
    cinder_csi: { enabled: true, default_volume_type: "high-speed" },
    hcloud_csi: { enabled: false },
    system_upgrade_controller: true,
    cni: "cilium"
  },
  k3s: { extra_server_args: ["--disable=traefik"], extra_agent_args: [] }
}

export const validMksConfig: MksClusterConfigEncoded = {
  name: "staging-eu",
  provider: "ovh",
  distro: "ovh-mks",
  version: "v1.31.4",
  auth: { method: "application_credential", region: "DE1" },
  worker_pools: [{ name: "general", flavor: "d2-4", count: 1 }],
  dns: { module: "none" },
  volumes: { module: "none" },
  object_storage: { module: "none" },
  secrets: { sink: "none" }
}

export const validMksNetwork = {
  cidr: "10.0.0.0/16",
  nodes_subnet: "10.0.1.0/24",
  load_balancers_subnet: "10.0.2.0/24"
} as const

export const validUpcloudUksConfig: UpcloudUksClusterConfigEncoded = {
  name: "staging-eu",
  provider: "upcloud",
  distro: "upcloud-uks",
  version: "1.31",
  zone: "de-fra1",
  auth: { method: "api_token", region: "de-fra1" },
  network: { cidr: "10.0.0.0/16" },
  worker_pools: [{ name: "general", flavor: "2xCPU-4GB", count: 1 }],
  dns: { module: "none" },
  volumes: { module: "none" },
  object_storage: { module: "none" },
  secrets: { sink: "none" }
}
