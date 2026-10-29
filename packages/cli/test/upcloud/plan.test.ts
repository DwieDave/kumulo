import { PlanAction } from "@kumulo/core"
import { assert, it } from "@effect/vitest"
import { decodeUpcloudTestConfig } from "../fixtures.ts"
import { validUpcloudUksConfig } from "../config/fixtures.ts"
import { buildUpcloudPlan, uksPoolRow } from "../../src/upcloud/plan.ts"
import type { UpcloudInventory } from "../../src/upcloud/plan.ts"
import { uksPoolHash, uksPoolName } from "@kumulo/distro-upcloud-uks"

const _config = decodeUpcloudTestConfig(validUpcloudUksConfig)

const _empty: UpcloudInventory = { clusterExists: false, nodeGroups: [], networkExists: false }

const _pool = { name: "general", plan: "2xCPU-4GB", count: 1 }

const _live: UpcloudInventory = {
  clusterExists: true,
  uuid: "uks-1",
  zone: "de-fra1",
  plan: undefined,
  networkCidr: "10.0.0.0/16",
  storageEncryption: undefined,
  version: "1.31",
  networkExists: true,
  nodeGroups: [{ name: uksPoolName(_pool), count: 1, poolLabel: "general", configHash: uksPoolHash(_pool) }]
}

it("plans router, network, cluster and one row per pool on an empty inventory", () => {
  const plan = buildUpcloudPlan({ config: _config, inventory: _empty })
  assert.deepStrictEqual(plan.actions, [
    PlanAction.Create({ name: "router/staging-eu" }),
    PlanAction.Create({ name: "network/staging-eu" }),
    PlanAction.Create({ name: "uks-cluster/staging-eu" }),
    PlanAction.Create({ name: uksPoolRow({ cluster: "staging-eu", pool: "general" }) })
  ])
})

it("is all NoOp against a converged inventory (AC2 at plan level)", () => {
  const plan = buildUpcloudPlan({ config: _config, inventory: _live })
  assert.isTrue(plan.actions.every((action) => PlanAction.$is("NoOp")(action)), JSON.stringify(plan.actions))
})

// AC6: creation-time drift must be named at PLAN time, not discovered at apply.
it("names a changed network CIDR as ReplaceNeedsConfirm, never a silent NoOp", () => {
  const plan = buildUpcloudPlan({
    config: { ..._config, network: { cidr: "10.9.0.0/16" } },
    inventory: _live
  })

  const cluster = plan.actions.find((action) => action.name === "uks-cluster/staging-eu")
  assert.strictEqual(cluster?._tag, "ReplaceNeedsConfirm")

  if (cluster?._tag === "ReplaceNeedsConfirm") assert.include(cluster.reason, "network_cidr")
})

it("names a changed zone as ReplaceNeedsConfirm", () => {
  const plan = buildUpcloudPlan({ config: { ..._config, zone: "fi-hel2" }, inventory: _live })
  const cluster = plan.actions.find((action) => action.name === "uks-cluster/staging-eu")
  assert.strictEqual(cluster?._tag, "ReplaceNeedsConfirm")
})

it("plans a Create for a pool the cluster does not have yet", () => {
  const plan = buildUpcloudPlan({
    config: { ..._config, worker_pools: [..._config.worker_pools, { name: "gpu", flavor: "4xCPU-8GB", count: 2 }] },
    inventory: _live
  })

  assert.deepStrictEqual(
    plan.actions.find((action) => action.name === uksPoolRow({ cluster: "staging-eu", pool: "gpu" })),
    PlanAction.Create({ name: uksPoolRow({ cluster: "staging-eu", pool: "gpu" }) })
  )
})

it("plans a live version behind the config as Update pointing at kumulo upgrade", () => {
  const plan = buildUpcloudPlan({ config: _config, inventory: { ..._live, version: "1.30" } })
  const cluster = plan.actions.find((action) => action.name === "uks-cluster/staging-eu")
  assert.strictEqual(cluster?._tag, "Update")

  if (cluster?._tag === "Update") assert.include(cluster.reason, "run kumulo upgrade")
})

it("plans a live version ahead of the config as ReplaceNeedsConfirm", () => {
  const plan = buildUpcloudPlan({ config: _config, inventory: { ..._live, version: "1.32" } })
  const cluster = plan.actions.find((action) => action.name === "uks-cluster/staging-eu")
  assert.strictEqual(cluster?._tag, "ReplaceNeedsConfirm")

  if (cluster?._tag === "ReplaceNeedsConfirm") assert.include(cluster.reason, "UKS cannot downgrade")
})
