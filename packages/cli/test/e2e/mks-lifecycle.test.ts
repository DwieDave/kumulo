import { Effect, Layer } from "effect"
import { layerNoop } from "effect/FileSystem"
import { assert, it } from "@effect/vitest"
import { loadConfig } from "../../src/config.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { buildMksPlan } from "../../src/mks/plan.ts"
import { applyMksEffect, deleteMksEffect, kubeconfigMks, lookupMksInventory } from "../../src/mks/reconcile.ts"
import { cloudProviderNever, fakeCloudProvider } from "../mks/fake-cloud-provider.ts"
import { decidePlanAction, renderPlan } from "../../src/present.ts"
import { makeFakeMksServer } from "./fake-mks-server.ts"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { CloudProvider, dnsNoopLive } from "@kumulo/core"
import { Ref } from "effect"
import { cdnYamlBlock, makeFakeCdn } from "../cdn-fakes.ts"
import { cdnPlanActions } from "../../src/cdn.ts"
import { deleteMksWithCdn } from "../../src/mks/reconcile.ts"

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

    if (config.distro !== "ovh-mks") throw new Error("unreachable")

    const inventory = yield* lookupMksInventory(config).pipe(Effect.provide(mksEnvLayer), Effect.provide(cloudProviderNever))
    const plan = buildMksPlan({ config, inventory: { ...inventory, volumeNames: new Set() } })
    assert.strictEqual(plan.actions.length, 2)
    const decision = decidePlanAction({ plan, yes: true, dryRun: false })
    assert.strictEqual(decision._tag, "Proceed")
    assert.match(renderPlan(plan), /Plan: 2 to create/)

    const info = yield* applyMksEffect({ config }).pipe(Effect.provide(mksEnvLayer), Effect.provide(dnsNoopLive), Effect.provide(cloudProviderNever))
    assert.strictEqual(info.status, "READY")

    const after = yield* lookupMksInventory(config).pipe(Effect.provide(mksEnvLayer), Effect.provide(cloudProviderNever))
    assert.ok(after.poolHashes?.get("workers"), "fake must replay the pool template's config-hash annotation")
    const replan = buildMksPlan({ config, inventory: { ...after, volumeNames: new Set() } })
    assert.deepStrictEqual(replan.actions.map((a) => a._tag), ["NoOp", "NoOp"])
    assert.strictEqual([...(server.pools.get(info.id)?.values() ?? [])][0]?.desiredNodes, 3)

    const [firstPool] = config.worker_pools
    assert.ok(firstPool, "fixture must define a worker pool")
    const scaledConfig = { ...config, worker_pools: [{ ...firstPool, count: 5 }] }
    yield* applyMksEffect({ config: scaledConfig }).pipe(Effect.provide(mksEnvLayer), Effect.provide(dnsNoopLive), Effect.provide(cloudProviderNever))
    assert.strictEqual([...(server.pools.get(info.id)?.values() ?? [])][0]?.desiredNodes, 5)

    const kubeconfig = yield* kubeconfigMks(config).pipe(Effect.provide(mksEnvLayer))
    assert.match(kubeconfig.content, /kind: Config/)

    yield* deleteMksEffect(config).pipe(Effect.provide(mksEnvLayer), Effect.provide(dnsNoopLive), Effect.provide(cloudProviderNever))
    assert.strictEqual(server.clusters.has(info.id), false)
  }).pipe(Effect.provide(_fsTestLayer)))

const _cdnYaml = _yaml
  .replace("masters:", "network:\n  cidr: 10.0.0.0/16\n  nodes_subnet: 10.0.1.0/24\n  load_balancers_subnet: 10.0.2.0/24\ningress: {}\nmasters:")
  .replace("secrets:\n  sink: none\n  dir: .\n", `secrets:\n  sink: none\n  dir: .\n${cdnYamlBlock()}`)

it.effect("cdn: plan -> apply -> replan is NoOp -> delete tears the edge down before the cluster", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer()
    const mksEnvLayer = Layer.succeed(MksEnv, { mks: makeMksClient(server.httpClient), serviceName: "service-1" })

    const cloudLayer = Layer.effect(
      CloudProvider,
      Effect.map(CloudProvider, (base) => ({ ...base, deleteByTag: () => Effect.void }))
    ).pipe(Layer.provide(fakeCloudProvider().layer))

    const fake = makeFakeCdn()
    fake.pullZone.setDnsReady("app.example.com", true)
    const config = yield* loadConfig(_configPath)

    const planned = yield* cdnPlanActions({ config, cdn: fake.handle })
    assert.deepStrictEqual(planned.map((a) => a._tag), ["Create", "Create"])

    const info = yield* applyMksEffect({ config, cdn: fake.handle }).pipe(
      Effect.provide(mksEnvLayer),
      Effect.provide(dnsNoopLive),
      Effect.provide(cloudLayer)
    )

    assert.strictEqual(info.status, "READY")

    assert.strictEqual(fake.pullZone.zones()[0]?.OriginUrl, "https://203.0.113.1")

    const replanned = yield* cdnPlanActions({ config, cdn: fake.handle })
    assert.deepStrictEqual(replanned.map((a) => a._tag), ["NoOp", "NoOp"])
    assert.ok((yield* Ref.get(fake.state)).pullZoneId !== undefined)

    yield* deleteMksWithCdn({ config, cdn: fake.handle }).pipe(
      Effect.provide(mksEnvLayer),
      Effect.provide(dnsNoopLive),
      Effect.provide(cloudLayer)
    )
    assert.strictEqual(fake.pullZone.zones().length, 0)
    assert.strictEqual(server.clusters.has(info.id), false)
  }).pipe(Effect.provide(layerNoop({ readFileString: () => Effect.succeed(_cdnYaml) }))))
