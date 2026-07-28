import { Effect, Layer } from "effect"
import { layerNoop } from "effect/FileSystem"
import { assert, it } from "@effect/vitest"
import { dnsNoopLive } from "@kumulo/core"
import { makeMksClient } from "@kumulo/distro-ovh-mks"
import { loadConfig } from "../../src/config.ts"
import { MksEnv } from "../../src/mks/env.ts"
import { applyMksEffect } from "../../src/mks/reconcile.ts"
import { makeFakeMksServer } from "../e2e/fake-mks-server.ts"
import { defaultLbInfo, fakeCloudProvider } from "./fake-cloud-provider.ts"

const _yaml = (blocks: string) => `
name: staging
provider: ovh
distro: ovh-mks
version: "1.31.0"
auth:
  method: application_credential
  region: GRA5
${blocks}worker_pools: []
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

// R12/R10 — the LB shares the cluster's network and sits on the subnet MKS was
// told to use for load balancers, and everything that shapes it is set at
// creation (D4). `members` stays empty: the CCM owns pools once a Service
// adopts the LB (R14/D2).
it.effect("creates an ingress load balancer on the cluster's load-balancer subnet, with a floating IP", () =>
  Effect.gen(function*() {
    const server = makeFakeMksServer()
    const cloud = fakeCloudProvider()

    const info = yield* _run({ cloud, server })

    assert.deepStrictEqual(cloud.lbSpecs, [{
      members: [],
      floatingIp: true,
      vipNetworkId: "net-1",
      vipSubnetId: "subnet-lb-1",
      flavorId: "flavor-uuid-1"
    }])
    assert.strictEqual(server.clusters.size, 1)
    // R13 — the ids travel back out so the caller can record them in
    // `<cluster>.outputs.yaml` once every converge step has finished.
    assert.deepStrictEqual(info.ingress, defaultLbInfo)
  }).pipe(_withYaml(_yaml(`${_NETWORK}ingress:\n  flavor_id: flavor-uuid-1\n`))))

it.effect("omits the flavor when the ingress block names none", () =>
  Effect.gen(function*() {
    const cloud = fakeCloudProvider()

    yield* _run({ cloud, server: makeFakeMksServer() })

    assert.deepStrictEqual(cloud.lbSpecs, [{
      members: [],
      floatingIp: true,
      vipNetworkId: "net-1",
      vipSubnetId: "subnet-lb-1"
    }])
  }).pipe(_withYaml(_yaml(`${_NETWORK}ingress: {}\n`))))

// R14/N2 — re-applying a config whose LB an ingress controller has already
// adopted asks for exactly the same thing again. Nothing about the CCM's
// listeners or pools is in the spec, so nothing about them can drift; the
// provider-side proof that this converges to a pure read lives in
// `packages/openstack/test/provider/cloud-provider.test.ts`.
it.effect("re-applying an adopted ingress LB asks for the identical spec and returns the identical info", () =>
  Effect.gen(function*() {
    const cloud = fakeCloudProvider()
    const server = makeFakeMksServer()

    const first = yield* _run({ cloud, server })
    const second = yield* _run({ cloud, server })

    assert.deepStrictEqual(second.ingress, first.ingress)
    assert.strictEqual(cloud.lbSpecs.length, 2)
    assert.deepStrictEqual(cloud.lbSpecs[1], cloud.lbSpecs[0])
    assert.strictEqual(server.clusters.size, 1)
  }).pipe(_withYaml(_yaml(`${_NETWORK}ingress: {}\n`))))

// Absent `ingress` is today's behaviour: no Octavia call at all, so a config
// that never asked for a load balancer never needs Octavia in its region.
it.effect("touches no load balancer when the config declares no ingress", () =>
  Effect.gen(function*() {
    const cloud = fakeCloudProvider()

    yield* _run({ cloud, server: makeFakeMksServer() })

    assert.deepStrictEqual(cloud.lbSpecs, [])
  }).pipe(_withYaml(_yaml(_NETWORK))))

// R10 — placement is required on MKS: an LB Octavia places wherever it likes is
// unreachable from the cluster. Rejected at decode, not discovered at apply.
it.effect("rejects an ingress block on a config that declares no network", () =>
  Effect.gen(function*() {
    const failure = yield* Effect.flip(loadConfig("cluster.yaml"))
    assert.strictEqual(failure._tag, "ConfigInvalid")
    assert.include(JSON.stringify(failure), "network")
  }).pipe(_withYaml(_yaml("ingress: {}\n"))))
