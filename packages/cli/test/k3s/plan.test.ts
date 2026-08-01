import { assert, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { FastCheck as fc } from "effect/testing"
import { CloudProvider, configHash, toTaggedResource } from "@kumulo/core"
import type { Inventory, TaggedResource } from "@kumulo/core"
import type { K3sClusterConfigEncoded } from "../../src/cluster-config.ts"
import { buildK3sNodes, buildK3sPlan, buildK3sServerSpecs, k3sPlanEffect, k3sPlanFor } from "../../src/k3s/plan.ts"
import { decodeK3sTestConfig } from "../fixtures.ts"

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

const LIVE_INFRA = { network: true, securityGroups: true, loadBalancer: true }

const _config = decodeK3sTestConfig(_encoded)

it("builds one ServerSpec per master and per worker-pool index, per-index named", () => {
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

it("plans one Create action per desired node when nothing is provisioned yet", () => {
  const plan = buildK3sPlan(_config)
  assert.strictEqual(plan.actions.length, 8)
  assert.ok(plan.actions.every((a) => a._tag === "Create"))
})

const _observedFor = (config: typeof _config): ReadonlyArray<TaggedResource> =>
  buildK3sServerSpecs(config).map((spec) => ({ name: spec.name }))

const _variant = (
  { masters = 3, workers = 2, workerFlavor = "b3-16" }: {
    readonly masters?: number
    readonly workers?: number
    readonly workerFlavor?: string
  }
) =>
  decodeK3sTestConfig({
    ..._encoded,
    masters: { ..._encoded.masters, count: masters },
    worker_pools: [{ name: "general", flavor: workerFlavor, count: workers, labels: { workload: "general" } }]
  })

it("a converged cluster plans all NoOp", () => {
  const plan = k3sPlanFor({ config: _config, observed: _observedFor(_config), infra: LIVE_INFRA })
  assert.ok(plan.actions.every((a) => a._tag === "NoOp"), JSON.stringify(plan.actions))
})

it("adding a node plans exactly one Create, the rest NoOp", () => {
  const plan = k3sPlanFor({ config: _variant({ workers: 3 }), observed: _observedFor(_config), infra: LIVE_INFRA })
  assert.deepStrictEqual(plan.actions.filter((a) => a._tag !== "NoOp"), [
    { _tag: "Create", name: "kumulo-prod-eu-worker-general-3" }
  ])
})

it("removing a node from config plans a Delete", () => {
  const plan = k3sPlanFor({ config: _variant({ workers: 1 }), observed: _observedFor(_config), infra: LIVE_INFRA })
  assert.deepStrictEqual(plan.actions.filter((a) => a._tag !== "NoOp"), [
    { _tag: "Delete", name: "kumulo-prod-eu-worker-general-2" }
  ])
})

it("a changed node property plans a confirmed replace when the inventory carries a config hash", () => {
  const observed = buildK3sNodes(_config).map(toTaggedResource)
  const plan = k3sPlanFor({ config: _variant({ workerFlavor: "b3-32" }), observed, infra: LIVE_INFRA })
  assert.deepStrictEqual(plan.actions.filter((a) => a._tag !== "NoOp").map((a) => [a._tag, a.name]), [
    ["ReplaceNeedsConfirm", "kumulo-prod-eu-worker-general-1"],
    ["ReplaceNeedsConfirm", "kumulo-prod-eu-worker-general-2"]
  ])
})

it.prop("observed === desired is always all-NoOp", [fc.constantFrom(1, 3, 5), fc.integer({ min: 0, max: 5 })], (
  [masters, workers]
) => {
  const config = _variant({ masters, workers })
  return k3sPlanFor({ config, observed: _observedFor(config), infra: LIVE_INFRA }).actions.every((a) => a._tag === "NoOp")
})

// only `listClusterResources` is on the plan path; the rest die if called.
const _unused = Effect.die("not part of the plan path")
const _inventoryOf = (servers: Inventory["servers"]): Layer.Layer<CloudProvider> =>
  Layer.succeed(CloudProvider, {
    ensureNetwork: () => _unused,
    findNetwork: () => _unused,
    hasGateway: () => Effect.succeed(false),
    ensureSecurityGroups: () => _unused,
    ensureLoadBalancer: () => _unused,
    ensureServer: () => _unused,
    deleteServer: () => _unused,
    deleteByTag: () => _unused,
    resolveImage: () => _unused,
    resolveFlavor: () => _unused,
    listClusterResources: () => Effect.succeed({ servers, networks: [{ id: "net-1", cidr: "10.0.0.0/16" }], securityGroups: [{ id: "sg-1" }], loadBalancers: [{ id: "lb-1", vip: "10.0.0.250" }] })
  })

const _stamped = (config: typeof _config): Inventory["servers"] =>
  buildK3sNodes(config).map((node, index) => ({
    id: `srv-${index}`,
    name: node.spec.name,
    ip: `10.0.0.${index}`,
    configHash: configHash(node.spec)
  }))

it.effect("live inventory stamped from the same config plans all NoOp", () =>
  k3sPlanEffect(_config).pipe(
    Effect.tap((plan) => Effect.sync(() => assert.ok(plan.actions.every((a) => a._tag === "NoOp"), JSON.stringify(plan.actions)))),
    Effect.provide(_inventoryOf(_stamped(_config)))
  ))

it.effect("a flavor change in config surfaces as drift against the live inventory", () =>
  k3sPlanEffect(_variant({ workerFlavor: "b3-32" })).pipe(
    Effect.tap((plan) =>
      Effect.sync(() =>
        assert.deepStrictEqual(plan.actions.filter((a) => a._tag !== "NoOp").map((a) => [a._tag, a.name]), [
          ["ReplaceNeedsConfirm", "kumulo-prod-eu-worker-general-1"],
          ["ReplaceNeedsConfirm", "kumulo-prod-eu-worker-general-2"]
        ])
      )
    ),
    Effect.provide(_inventoryOf(_stamped(_config)))
  ))

it.effect("servers created before hash stamping never plan as drifted", () =>
  k3sPlanEffect(_variant({ workerFlavor: "b3-32" })).pipe(
    Effect.tap((plan) => Effect.sync(() => assert.ok(plan.actions.every((a) => a._tag === "NoOp"), JSON.stringify(plan.actions)))),
    Effect.provide(_inventoryOf(_stamped(_config).map(({ configHash: _drop, ...rest }) => rest)))
  ))
