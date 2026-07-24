import { Effect, Layer } from "effect"
import { layerNoop } from "effect/FileSystem"
import { assert, it } from "@effect/vitest"
import { loadConfig } from "../../src/config.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { buildMksPlan } from "../../src/mks/plan.ts"
import { applyMks, deleteMks, kubeconfigMks } from "../../src/mks/reconcile.ts"
import { decidePlanAction, renderPlan } from "../../src/present.ts"
import { makeFakeMksServer } from "./fake-mks-server.ts"
import { makeMksClient } from "@kumulo/distro-ovh-mks"

const _yaml = `
name: prod-eu
provider: ovh
distro: ovh-mks
version: "1.31.0"
auth:
  method: application_credential
  region: GRA5
network:
  cidr: 10.0.0.0/16
  public_access: nat
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
  retained: []
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

    const plan = buildMksPlan(config)
    assert.strictEqual(plan.actions.length, 2)
    const decision = decidePlanAction({ plan, yes: true, dryRun: false })
    assert.strictEqual(decision._tag, "Proceed")
    assert.match(renderPlan(plan), /Plan: 2 to create/)

    const info = yield* applyMks(config).pipe(Effect.provide(mksEnvLayer))
    assert.strictEqual(info.status, "READY")
    assert.strictEqual([...server.pools.get(info.id)!.values()][0]?.desiredNodes, 3)

    // scale: re-run apply with a bumped worker count — same reconcile.
    const scaledConfig = { ...config, worker_pools: [{ ...config.worker_pools[0]!, count: 5 }] }
    yield* applyMks(scaledConfig).pipe(Effect.provide(mksEnvLayer))
    assert.strictEqual([...server.pools.get(info.id)!.values()][0]?.desiredNodes, 5)

    const kubeconfig = yield* kubeconfigMks(config).pipe(Effect.provide(mksEnvLayer))
    assert.match(kubeconfig.content, /kind: Config/)

    yield* deleteMks(config).pipe(Effect.provide(mksEnvLayer))
    assert.strictEqual(server.clusters.has(info.id), false)
  }).pipe(Effect.provide(_fsTestLayer)))
