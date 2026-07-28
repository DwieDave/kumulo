import { Effect, Layer } from "effect"
import { layerNoop } from "effect/FileSystem"
import { assert, it } from "@effect/vitest"
import { loadConfig } from "../../src/config.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { buildMksPlan } from "../../src/mks/plan.ts"
import { applyMksEffect, deleteMksEffect, kubeconfigMks, lookupMksInventory } from "../../src/mks/reconcile.ts"
import { cloudProviderNever } from "../mks/fake-cloud-provider.ts"
import { decidePlanAction, renderPlan } from "../../src/present.ts"
import { makeFakeMksServer } from "./fake-mks-server.ts"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { dnsNoopLive } from "@kumulo/core"

const _yaml = `
name: prod-eu
provider: ovh
distro: ovh-mks
version: "1.31.0"
auth:
  method: application_credential
  region: GRA5
api_server:
  high_availability: true
  allowed_cidrs: ["0.0.0.0/0"]
ssh:
  public_key_path: ~/.ssh/id_ed25519.pub
  allowed_cidrs: ["0.0.0.0/0"]
masters:
  flavor: b2-7
  count: 3
  image: ubuntu-22.04
worker_pools:
  - name: workers
    flavor: b2-7
    count: 3
    autoscaling:
      enabled: true
      min: 1
      max: 5
dns:
  module: none
  zone: unused.example.com
  ttl: 300
  records: []
volumes:
  module: none
  managed: []
object_storage:
  module: none
  buckets: []
secrets:
  sink: none
  dir: .
addons:
  cloud_controller_manager: true
  cinder_csi:
    enabled: false
    default_volume_type: unused
  hcloud_csi:
    enabled: false
  system_upgrade_controller: false
  cni: flannel
k3s:
  extra_server_args: []
  extra_agent_args: []
`

const _configPath = "cluster.yaml"

const _fsTestLayer = layerNoop({
  readFileString: () => Effect.succeed(_yaml)
})

it.effect("yaml → plan → apply → nodepool scale-update → kubeconfig → delete (fixture-replayed OVH API)", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer()
    const mksEnvLayer = Layer.succeed(MksEnv, { mks: makeMksClient(server.httpClient), serviceName: "service-1" })

    const config = yield* loadConfig(_configPath)
    assert.strictEqual(config.distro, "ovh-mks")

    const inventory = yield* lookupMksInventory(config).pipe(Effect.provide(mksEnvLayer))
    const plan = buildMksPlan({ config, inventory: { ...inventory, volumeNames: new Set() } })
    assert.strictEqual(plan.actions.length, 2)
    const decision = decidePlanAction({ plan, yes: true, dryRun: false })
    assert.strictEqual(decision._tag, "Proceed")
    assert.match(renderPlan(plan), /Plan: 2 to create/)

    const info = yield* applyMksEffect({ config }).pipe(Effect.provide(mksEnvLayer), Effect.provide(dnsNoopLive), Effect.provide(cloudProviderNever))
    assert.strictEqual(info.status, "READY")

    // Re-plan against the now-populated fake API: everything exists -> all NoOp.
    const after = yield* lookupMksInventory(config).pipe(Effect.provide(mksEnvLayer))
    // Guards the NoOp assertion below against going vacuous again: it only
    // means "converged" if the fake really replayed the stamped template.
    assert.ok(after.poolHashes?.get("workers"), "fake must replay the pool template's config-hash annotation")
    const replan = buildMksPlan({ config, inventory: { ...after, volumeNames: new Set() } })
    assert.deepStrictEqual(replan.actions.map((a) => a._tag), ["NoOp", "NoOp"])
    assert.strictEqual([...(server.pools.get(info.id)?.values() ?? [])][0]?.desiredNodes, 3)

    // scale: re-run apply with a bumped worker count — same reconcile.
    const [firstPool] = config.worker_pools
    assert.ok(firstPool, "fixture must define a worker pool")
    const scaledConfig = { ...config, worker_pools: [{ ...firstPool, count: 5 }] }
    yield* applyMksEffect({ config: scaledConfig }).pipe(Effect.provide(mksEnvLayer), Effect.provide(dnsNoopLive), Effect.provide(cloudProviderNever))
    assert.strictEqual([...(server.pools.get(info.id)?.values() ?? [])][0]?.desiredNodes, 5)

    const kubeconfig = yield* kubeconfigMks(config).pipe(Effect.provide(mksEnvLayer))
    assert.match(kubeconfig.content, /kind: Config/)

    yield* deleteMksEffect(config).pipe(Effect.provide(mksEnvLayer), Effect.provide(dnsNoopLive))
    assert.strictEqual(server.clusters.has(info.id), false)
  }).pipe(Effect.provide(_fsTestLayer)))
