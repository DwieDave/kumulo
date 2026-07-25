import { assert, it } from "@effect/vitest"
import type { K3sClusterConfigEncoded } from "@kumulo/core"
import { buildK3sPlan, buildK3sServerSpecs } from "../../src/k3s/plan.ts"
import { decodeK3sTestConfig } from "../fixtures.ts"

// Same fixture core's own tests use.
const _encoded: K3sClusterConfigEncoded = {
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

const _config = decodeK3sTestConfig(_encoded)

it("builds one ServerSpec per master and per worker-pool index, per-index named (Appendix B)", () => {
  const specs = buildK3sServerSpecs(_config)
  assert.deepStrictEqual(specs.map((s) => s.name), [
    "kumulo-prod-eu-master-masters-1",
    "kumulo-prod-eu-master-masters-2",
    "kumulo-prod-eu-master-masters-3",
    "kumulo-prod-eu-worker-general-1",
    "kumulo-prod-eu-worker-general-2"
  ])
  assert.ok(specs.every((s) => s.tag === "prod-eu"))
  assert.deepStrictEqual(specs.map((s) => s.role), ["master", "master", "master", "worker", "worker"])
})

it("plans one Create action per desired node", () => {
  const plan = buildK3sPlan(_config)
  assert.strictEqual(plan.actions.length, 5)
  assert.ok(plan.actions.every((a) => a._tag === "Create"))
})
