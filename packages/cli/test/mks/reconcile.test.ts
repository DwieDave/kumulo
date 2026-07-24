import { Effect, Layer } from "effect"
import { layerNoop } from "effect/FileSystem"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { assert, it } from "@effect/vitest"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { loadConfig } from "../../src/config.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { deleteMks, kubeconfigMks } from "../../src/mks/reconcile.ts"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"

// kumulo: asserts "no cluster was ever created" by watching for the one POST
// that creates a cluster (`POST .../kube`), not just the end-state cluster
// count — a create-then-delete round trip would also leave `clusters.size`
// at 0, silently passing a test that only checked the count.
const _withCreateSpy = (server: ReturnType<typeof makeFakeMksServer>) => {
  let created = false
  const httpClient = HttpClient.tap(server.httpClient, (response) => {
    if (response.request.method === "POST" && new URL(response.request.url).pathname.endsWith("/kube")) created = true
    return Effect.void
  })
  return { httpClient, wasCreated: () => created }
}

const _yaml = `
name: never-created
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
worker_pools: []
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
  system_upgrade_controller: false
  cni: flannel
k3s:
  extra_server_args: []
  extra_agent_args: []
`

const _fsTestLayer = layerNoop({ readFileString: () => Effect.succeed(_yaml) })

it.effect("delete against a nonexistent MKS cluster is a no-op, never creates one", () =>
  Effect.gen(function*() {
    const config = yield* loadConfig("cluster.yaml")
    const server = makeFakeMksServer()
    const spy = _withCreateSpy(server)
    const mksEnvLayer = Layer.succeed(MksEnv, { mks: makeMksClient(spy.httpClient), serviceName: "service-1" })

    yield* deleteMks(config).pipe(Effect.provide(mksEnvLayer))

    assert.strictEqual(spy.wasCreated(), false)
    assert.strictEqual(server.clusters.size, 0)
  }).pipe(Effect.provide(_fsTestLayer)))

it.effect("kubeconfig against a nonexistent MKS cluster fails without creating one", () =>
  Effect.gen(function*() {
    const config = yield* loadConfig("cluster.yaml")
    const server = makeFakeMksServer()
    const spy = _withCreateSpy(server)
    const mksEnvLayer = Layer.succeed(MksEnv, { mks: makeMksClient(spy.httpClient), serviceName: "service-1" })

    const failure = yield* kubeconfigMks(config).pipe(Effect.provide(mksEnvLayer), Effect.flip)

    assert.strictEqual(failure._tag, "ResourceNotFound")
    assert.strictEqual(spy.wasCreated(), false)
  }).pipe(Effect.provide(_fsTestLayer)))
