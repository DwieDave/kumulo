import { Effect, Layer } from "effect"
import { layerNoop } from "effect/FileSystem"
import * as HttpClient from "effect/unstable/http/HttpClient"
import { assert, it } from "@effect/vitest"
import { dnsNoopLive } from "@kumulo/core"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { loadConfig } from "../../src/config.ts"
import { OpenStackEnv } from "../../src/doctor-openstack/env.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { applyMks, applyMksEffect } from "../../src/mks/reconcile.ts"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { fakeCloudProvider } from "./fake-cloud-provider.ts"

const _yaml = (networkYaml: string) => `
name: staging
provider: ovh
distro: ovh-mks
version: "1.31.0"
auth:
  method: application_credential
  region: GRA5
${networkYaml}worker_pools: []
dns:
  module: none
volumes:
  module: none
object_storage:
  module: none
secrets:
  sink: none
`

const _NETWORK = `network:
  cidr: 10.0.0.0/16
  nodes_subnet: 10.0.1.0/24
  load_balancers_subnet: 10.0.2.0/24
`

const _run = (
  { cloud, server }: {
    readonly cloud: ReturnType<typeof fakeCloudProvider>
    readonly server: ReturnType<typeof makeFakeMksServer>
  }
) =>
  Effect.gen(function*() {
    const config = yield* loadConfig("cluster.yaml")
    return yield* applyMksEffect({ config })
  }).pipe(
    Effect.provide(Layer.succeed(MksEnv, { mks: makeMksClient(server.httpClient), serviceName: "service-1" })),
    Effect.provide(cloud.layer),
    Effect.provide(dnsNoopLive)
  )

const _withYaml = (yaml: string) => Effect.provide(layerNoop({ readFileString: () => Effect.succeed(yaml) }))

it.effect("creates the network first and hands all three ids to cluster creation", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer()
    const cloud = fakeCloudProvider()

    const info = yield* _run({ cloud, server })

    assert.deepStrictEqual(cloud.specs, [{
      cidr: "10.0.0.0/16",
      nodesSubnet: "10.0.1.0/24",
      loadBalancersSubnet: "10.0.2.0/24"
    }])
    const created = server.clusters.get(info.id)
    assert.strictEqual(created?.privateNetworkId, "net-1")
    assert.strictEqual(created?.nodesSubnetId, "subnet-nodes-1")
    assert.strictEqual(created?.loadBalancersSubnetId, "subnet-lb-1")
  }).pipe(_withYaml(_yaml(_NETWORK))))

it.effect("touches neither vRack nor CloudProvider when the config declares no network", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer({ vrackId: null })
    const cloud = fakeCloudProvider()

    const info = yield* _run({ cloud, server })

    assert.deepStrictEqual(cloud.specs, [])
    assert.strictEqual(server.clusters.get(info.id)?.privateNetworkId, undefined)
  }).pipe(_withYaml(_yaml(""))))

it.effect("refuses before creating anything when the project has no vRack", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer({ vrackId: null })
    const cloud = fakeCloudProvider()

    const failure = yield* Effect.flip(_run({ cloud, server }))

    assert.strictEqual(failure._tag, "CapabilityMissing")
    assert.deepStrictEqual(cloud.specs, [])
    assert.strictEqual(server.clusters.size, 0)
  }).pipe(_withYaml(_yaml(_NETWORK))))

it.effect("fails loudly, creating no cluster, when a subnet id came back missing", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer()
    const cloud = fakeCloudProvider({ id: "net-1", cidr: "10.0.0.0/16", nodesSubnetId: "subnet-nodes-1" })

    const failure = yield* Effect.flip(_run({ cloud, server }))

    assert.strictEqual(failure._tag, "ResourceConflict")
    const rendered = JSON.stringify(failure)
    assert.include(rendered, "load_balancers_subnet 10.0.2.0/24")
    assert.include(rendered, "recreate")
    assert.strictEqual(server.clusters.size, 0)
  }).pipe(_withYaml(_yaml(_NETWORK))))

const _noOpenStackCredentials = Layer.succeed(OpenStackEnv, {
  keystone: undefined,
  region: undefined,
  unavailableReason: "no OS_* env vars"
})

it.effect("applies a networkless config with no OpenStack credentials present", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer({ vrackId: null })
    const config = yield* loadConfig("cluster.yaml")

    const info = yield* applyMks({ config }).pipe(
      Effect.provide(Layer.succeed(MksEnv, { mks: makeMksClient(server.httpClient), serviceName: "service-1" })),
      Effect.provide(_noOpenStackCredentials),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, server.httpClient))
    )

    assert.strictEqual(server.clusters.get(info.id)?.privateNetworkId, undefined)
  }).pipe(_withYaml(_yaml(""))))

it.effect("creates the gateway at the tier the config asked for", () =>
  Effect.gen(function*() {
    const cloud = fakeCloudProvider()
    const server = makeFakeMksServer()
    yield* _run({ cloud, server })
    assert.deepStrictEqual(server.gateways, [{ model: "l", name: "kumulo-staging" }])
  }).pipe(_withYaml(_yaml(`${_NETWORK}  gateway_model: l\n`))))

it.effect("defaults the tier to s when the config names none", () =>
  Effect.gen(function*() {
    const cloud = fakeCloudProvider()
    const server = makeFakeMksServer()
    yield* _run({ cloud, server })
    assert.deepStrictEqual(server.gateways, [{ model: "s", name: "kumulo-staging" }])
  }).pipe(_withYaml(_yaml(_NETWORK))))
