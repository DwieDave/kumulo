import { PlanAction } from "@kumulo/core"
import { assert, describe, it } from "@effect/vitest"
import { uksPoolHash, uksPoolName } from "@kumulo/distro-upcloud-uks"
import { decodeUpcloudTestConfig } from "../fixtures.ts"
import { validUpcloudUksConfig } from "../config/fixtures.ts"
import { buildUpcloudPlan } from "../../src/upcloud/plan.ts"
import type { UpcloudInventory } from "../../src/upcloud/plan.ts"

// the platform's second apply: api record first, then wildcard and apex records at the load balancer's address
const _records = [
  { name: "api.staging-eu", target: "api_server" },
  { name: "@", target: "203.0.113.10" },
  { name: "*", target: "203.0.113.10" },
  { name: "*.c1", target: "203.0.113.10" },
  { name: "www", target: "lb-0a1b2c.upcloudlb.com" }
]

const _config = decodeUpcloudTestConfig({
  ...validUpcloudUksConfig,
  control_plane_ip_filter: ["0.0.0.0/0"],
  dns: { module: "godaddy", zone: "example.com", ttl: 600, records: _records }
})

const _pool = { name: "general", plan: "2xCPU-4GB", count: 1 }

const _empty: UpcloudInventory = { clusterExists: false, nodeGroups: [], networkExists: false }

const _live: UpcloudInventory = {
  clusterExists: true,
  uuid: "uks-1",
  zone: "de-fra1",
  networkCidr: "10.0.0.0/16",
  version: "1.31",
  networkExists: true,
  nodeGroups: [{ name: uksPoolName(_pool), count: 1, poolLabel: "general", configHash: uksPoolHash(_pool) }]
}

const _infraRows = ["router/staging-eu", "network/staging-eu", "uks-cluster/staging-eu", "uks-pool/staging-eu/general"]

describe("upcloud-uks with dns.module godaddy", () => {
  it("decodes wildcard, apex and literal IP and hostname records unchanged", () => {
    assert.strictEqual(_config.dns.module, "godaddy")

    if (_config.dns.module === "godaddy") {
      assert.strictEqual(_config.dns.ttl, 600)
      assert.deepStrictEqual(_config.dns.records, _records)
    }
  })

  it("plans the cluster on an empty inventory", () => {
    const plan = buildUpcloudPlan({ config: _config, inventory: _empty })

    for (const name of _infraRows) assert.deepStrictEqual(plan.actions.find((action) => action.name === name), PlanAction.Create({ name }))
  })

  // dns rows are always Create, as on k3s and ovh-mks: the plan does not read the zone, apply converges it
  it("lists one dns row per record, so a dns-only change is not NothingToDo", () => {
    const dnsRows = [
      "dns/example.com/api.staging-eu (CNAME)",
      "dns/example.com/@ (A)",
      "dns/example.com/* (A)",
      "dns/example.com/*.c1 (A)",
      "dns/example.com/www (CNAME)"
    ]

    for (const inventory of [_empty, _live]) {
      const plan = buildUpcloudPlan({ config: _config, inventory })
      assert.deepStrictEqual(plan.actions.filter((action) => action.name.startsWith("dns/")), dnsRows.map((name) => PlanAction.Create({ name })))
    }
  })

  it("plans no infrastructure change on a converged inventory", () => {
    const plan = buildUpcloudPlan({ config: _config, inventory: _live })

    for (const name of _infraRows) assert.deepStrictEqual(plan.actions.find((action) => action.name === name), PlanAction.NoOp({ name }))
  })
})
