import { assert, it } from "@effect/vitest"
import { mksEntry } from "../../src/distro/mks-entry.ts"
import { buildMksPlan, emptyMksInventory, type MksInventory, type MksPlanInput } from "../../src/mks/plan.ts"

const _config: MksPlanInput = {
  name: "prod-eu",
  worker_pools: [{ name: "workers", flavor: "b2-7", count: 3 }, { name: "gpu", flavor: "t1-45", count: 1 }],
  volumes: { module: "none" }
}

it("one Create action per cluster plus one per worker pool on empty inventory", () => {
  const plan = buildMksPlan({ config: _config, inventory: emptyMksInventory })
  assert.deepStrictEqual(plan.actions, [
    { _tag: "Create", name: "mks-cluster/prod-eu" },
    { _tag: "Create", name: "mks-pool/prod-eu/workers" },
    { _tag: "Create", name: "mks-pool/prod-eu/gpu" }
  ])
})

it("adds a Create action per managed volume when volumes.module is cinder", () => {
  const plan = buildMksPlan({
    config: { ..._config, volumes: { module: "cinder", managed: [{ name: "data" }, { name: "logs" }] } },
    inventory: emptyMksInventory
  })
  assert.deepStrictEqual(plan.actions, [
    { _tag: "Create", name: "mks-cluster/prod-eu" },
    { _tag: "Create", name: "mks-pool/prod-eu/workers" },
    { _tag: "Create", name: "mks-pool/prod-eu/gpu" },
    { _tag: "Create", name: "volume/data" },
    { _tag: "Create", name: "volume/logs" }
  ])
})

it("shows no volume actions when volumes.module isn't cinder, even with managed entries present", () => {
  const plan = buildMksPlan({
    config: { ..._config, volumes: { module: "hcloud", managed: [{ name: "data" }] } },
    inventory: emptyMksInventory
  })
  assert.deepStrictEqual(plan.actions, [
    { _tag: "Create", name: "mks-cluster/prod-eu" },
    { _tag: "Create", name: "mks-pool/prod-eu/workers" },
    { _tag: "Create", name: "mks-pool/prod-eu/gpu" }
  ])
})

it("existing resources plan as NoOp; missing ones as Create", () => {
  const inventory: MksInventory = {
    clusterExists: true,
    poolNames: new Set(["workers"]),
    volumeNames: new Set(["data"])
  }
  const plan = buildMksPlan({
    config: { ..._config, volumes: { module: "cinder", managed: [{ name: "data" }, { name: "logs" }] } },
    inventory
  })
  assert.deepStrictEqual(plan.actions, [
    { _tag: "NoOp", name: "mks-cluster/prod-eu" },
    { _tag: "NoOp", name: "mks-pool/prod-eu/workers" },
    { _tag: "Create", name: "mks-pool/prod-eu/gpu" },
    { _tag: "NoOp", name: "volume/data" },
    { _tag: "Create", name: "volume/logs" }
  ])
})

it("pools never plan as NoOp when the cluster itself is missing", () => {
  const plan = buildMksPlan({ config: _config, inventory: { clusterExists: false, poolNames: new Set(["workers", "gpu"]), volumeNames: new Set() } })
  assert.deepStrictEqual(plan.actions.map((a) => a._tag), ["Create", "Create", "Create"])
})

const _networked: MksPlanInput = { ..._config, network: { cidr: "10.0.0.0/16" } }

it("plans the gateway alongside the network it is created with", () => {
  const plan = buildMksPlan({ config: _networked, inventory: emptyMksInventory })
  assert.deepStrictEqual(
    plan.actions.filter((a) => a.name.startsWith("gateway/")),
    [{ _tag: "Create", name: "gateway/prod-eu" }]
  )
})

it("plans no gateway when the config declares no network block", () => {
  const plan = buildMksPlan({ config: _config, inventory: emptyMksInventory })
  assert.deepStrictEqual(plan.actions.filter((a) => a.name.startsWith("gateway/")), [])
})

it("plans the network and both subnets ahead of the cluster when a network block is declared", () => {
  const plan = buildMksPlan({ config: _networked, inventory: emptyMksInventory })
  assert.deepStrictEqual(plan.actions.slice(0, 5), [
    { _tag: "Create", name: "network/prod-eu" },
    { _tag: "Create", name: "subnet/prod-eu/nodes" },
    { _tag: "Create", name: "subnet/prod-eu/load-balancers" },
    { _tag: "Create", name: "gateway/prod-eu" },
    { _tag: "Create", name: "mks-cluster/prod-eu" }
  ])
})

it("plans no network rows at all when the config declares no network block", () => {
  const plan = buildMksPlan({ config: _config, inventory: emptyMksInventory })
  assert.deepStrictEqual(plan.actions.filter((a) => a.name.startsWith("network/") || a.name.startsWith("subnet/")), [])
})

it("a cluster already on its private network plans the network rows as NoOp", () => {
  const inventory: MksInventory = {
    clusterExists: true,
    poolNames: new Set(),
    volumeNames: new Set(),
    clusterState: { region: "GRA5", privateNetworkId: "net-1" }
  }
  assert.deepStrictEqual(buildMksPlan({ config: _networked, inventory }).actions.slice(0, 3), [
    { _tag: "NoOp", name: "network/prod-eu" },
    { _tag: "NoOp", name: "subnet/prod-eu/nodes" },
    { _tag: "NoOp", name: "subnet/prod-eu/load-balancers" }
  ])
})

it("every row buildMksPlan emits for the cluster step matches an mksEntry appliedPrefix", () => {
  const owned = ["volume/", "bucket/", "dns/"]
  const rows = buildMksPlan({ config: _networked, inventory: emptyMksInventory }).actions
    .map((action) => action.name)
    .filter((name) => !owned.some((prefix) => name.startsWith(prefix)))
  assert.deepStrictEqual(rows.filter((name) => !mksEntry.appliedPrefixes.some((prefix) => name.startsWith(prefix))), [])
})

const _ingress: MksPlanInput = {
  ..._networked,
  ingress: {}
}

it("plans no ingress rows at all when the config declares no ingress block", () => {
  const plan = buildMksPlan({ config: _networked, inventory: emptyMksInventory })
  assert.deepStrictEqual(
    plan.actions.filter((a) => a.name.startsWith("load-balancer/") || a.name.startsWith("floating-ip/")),
    []
  )
})

it("plans a load-balancer and floating-ip row after the cluster rows", () => {
  const names = buildMksPlan({ config: _ingress, inventory: emptyMksInventory }).actions.map((a) => a.name)
  assert.deepStrictEqual(names.slice(-2), ["load-balancer/prod-eu/ingress", "floating-ip/prod-eu/ingress"])
  assert.isAbove(names.indexOf("load-balancer/prod-eu/ingress"), names.indexOf("mks-cluster/prod-eu"))
})

it("plans the ingress rows as NoOp once the cluster exists", () => {
  const inventory: MksInventory = {
    clusterExists: true,
    poolNames: new Set(),
    volumeNames: new Set(),
    clusterState: { region: "GRA5", privateNetworkId: "net-1" }
  }
  assert.deepStrictEqual(buildMksPlan({ config: _ingress, inventory }).actions.slice(-2), [
    { _tag: "NoOp", name: "load-balancer/prod-eu/ingress" },
    { _tag: "NoOp", name: "floating-ip/prod-eu/ingress" }
  ])
})

it("every ingress row matches an mksEntry appliedPrefix", () => {
  const rows = buildMksPlan({ config: _ingress, inventory: emptyMksInventory }).actions.map((a) => a.name)
  assert.deepStrictEqual(rows.filter((name) => !mksEntry.appliedPrefixes.some((prefix) => name.startsWith(prefix))), [])
})

// Editing a subnet CIDR on a live cluster keeps the same network id, so presence-only drift used to see nothing and apply failed later.
const _liveOn = (
  { desired, live }: {
    readonly live: { readonly nodes: string; readonly lbs: string }
    readonly desired: { readonly nodes: string; readonly lbs: string }
  }
): MksInventory => ({
  ...emptyMksInventory,
  clusterExists: true,
  clusterState: {
    region: "GRA5",
    privateNetworkId: "net-1",
    nodesSubnetId: live.nodes,
    loadBalancersSubnetId: live.lbs
  },
  resolvedNetwork: { id: "net-1", cidr: "10.0.0.0/16", nodesSubnetId: desired.nodes, loadBalancersSubnetId: desired.lbs }
})

const _clusterRow = (inventory: MksInventory) =>
  buildMksPlan({ config: { ..._networked, auth: { region: "GRA5" } }, inventory })
    .actions.find((a) => a.name === "mks-cluster/prod-eu")

it("refuses at plan time when a subnet CIDR resolves elsewhere than the cluster's own", () => {
  const row = _clusterRow(_liveOn({ live: { nodes: "sub-a", lbs: "sub-x" }, desired: { nodes: "sub-b", lbs: "sub-x" } }))
  assert.strictEqual(row?._tag, "ReplaceNeedsConfirm")
  assert.include(row?._tag === "ReplaceNeedsConfirm" ? row.reason : "", "recreate")
})

it("plans no cluster change when both subnets resolve to the cluster's own", () => {
  const row = _clusterRow(_liveOn({ live: { nodes: "sub-a", lbs: "sub-x" }, desired: { nodes: "sub-a", lbs: "sub-x" } }))
  assert.strictEqual(row?._tag, "NoOp")
})

it("claims no drift when the network does not exist yet", () => {
  const row = _clusterRow({
    ...emptyMksInventory,
    clusterExists: true,
    clusterState: { region: "GRA5", privateNetworkId: "net-1", nodesSubnetId: "sub-a", loadBalancersSubnetId: "sub-x" }
  })
  assert.strictEqual(row?._tag, "NoOp")
})
