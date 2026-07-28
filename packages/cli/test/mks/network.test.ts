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

// R7 — the ids are creation-time inputs to `Cloud_ProjectKubeCreation`, so the
// network has to exist before the cluster does, not beside it.
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

// R5 — no `network` block is today's behaviour: no vRack read, no Neutron call,
// no ids on the payload. A project without a vRack still provisions.
it.effect("touches neither vRack nor CloudProvider when the config declares no network", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer({ vrackId: null })
    const cloud = fakeCloudProvider()

    const info = yield* _run({ cloud, server })

    assert.deepStrictEqual(cloud.specs, [])
    assert.strictEqual(server.clusters.get(info.id)?.privateNetworkId, undefined)
  }).pipe(_withYaml(_yaml(""))))

// R4 — the vRack check is read-only and runs ahead of everything, so a refusal
// costs zero mutations: no Neutron network, no cluster.
it.effect("refuses before creating anything when the project has no vRack", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer({ vrackId: null })
    const cloud = fakeCloudProvider()

    const failure = yield* Effect.flip(_run({ cloud, server }))

    assert.strictEqual(failure._tag, "CapabilityMissing")
    assert.deepStrictEqual(cloud.specs, [])
    assert.strictEqual(server.clusters.size, 0)
  }).pipe(_withYaml(_yaml(_NETWORK))))

// `ensureNetwork` omits a subnet id rather than reporting `""` when the
// read-back didn't find the subnet. Passing that through would create a cluster
// on half a network, and networking can never be fixed afterwards. Editing a
// subnet CIDR on a live network lands here — the network exists, so kumulo
// never re-subnets it — so the message has to name the field and say recreate,
// not read as a stray Neutron 404 (R8).
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

// R5 regression guard: `applyMks` is the wired entrypoint and provides the
// OpenStack `CloudProvider` unconditionally. A config with no `network` block
// never calls a single OpenStack verb, so an absent OS_* environment must not
// fail the apply — the Layer has to defer its failure to first use, exactly as
// it advertises. `applyMksEffect` cannot catch this: it takes `CloudProvider`
// already built.
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
